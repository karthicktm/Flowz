import { createPipeline } from '../Pipeline';
import { getRecentVideos, getVideoComments, replyToComment, getOurChannelId } from '@/lib/youtube';
import { generateTweetReply } from '@/lib/openai'; // Reuse for comment replies
import { logger } from '@/lib/logger';
import { db, useSQLite } from '@/lib/db';
import {
  youtubeCommentRepliesTableSQLite,
  youtubeCommentRepliesTablePostgres,
  type NewYouTubeCommentReply
} from '@/lib/schema';
import { inArray } from 'drizzle-orm';
import { youtube_v3 } from 'googleapis';

/**
 * Reply to YouTube Comments Workflow
 *
 * Production-ready with:
 * - Automatic retries (circuit breakers on YouTube API)
 * - Rate limiting (YouTube: 10k quota units/day)
 * - Duplicate prevention (filters already-replied comments)
 * - Time-based filtering (24h, fallback to 48h)
 * - Batch processing (3-5 comments per run)
 * - Engagement-based ranking
 *
 * Steps:
 * 1. Fetch recent videos from channel (last 3-5 videos from 24-48h)
 * 2. Fetch comments from those videos
 * 3. Filter already-replied comments
 * 4. Filter our own comments
 * 5. Rank by engagement (likes + recency)
 * 6. Select top 3-5 comments
 * 7. Generate AI replies for each
 * 8. Post replies to YouTube
 * 9. Save to database
 */

interface Comment {
  id: string;
  videoId: string;
  videoTitle: string;
  text: string;
  authorDisplayName: string;
  authorChannelId: string;
  likeCount: number;
  publishedAt: string;
}

interface ReplyResult {
  id?: string;
  error?: string;
  dryRun?: boolean;
  skipped?: boolean;
}

interface WorkflowContext {
  channelId?: string;
  videos: youtube_v3.Schema$SearchResult[];
  allComments: Comment[];
  filteredComments: Comment[];
  selectedComments: Comment[];
  repliesData: Array<{
    comment: Comment;
    generatedReply: string;
    replyResult?: ReplyResult;
  }>;
}

interface WorkflowConfig {
  channelId?: string; // If not provided, uses authenticated channel
  maxVideos?: number; // Default: 5
  maxRepliesPerRun?: number; // Default: 3
  timeWindowHours?: number; // Default: 24 (extends to 48 if no comments)
  systemPrompt?: string;
  dryRun?: boolean;
}

/**
 * Calculate engagement score for a comment
 * Prioritizes likes + recency
 */
function calculateCommentScore(comment: Comment): number {
  const likes = comment.likeCount || 0;
  const ageInHours = (Date.now() - new Date(comment.publishedAt).getTime()) / (1000 * 60 * 60);

  // Recency bonus: higher score for newer comments
  let recencyBonus = 0;
  if (ageInHours < 24) recencyBonus = 50;
  else if (ageInHours < 72) recencyBonus = 20; // 3 days
  else if (ageInHours < 168) recencyBonus = 5; // 7 days

  // Length bonus for substantial comments
  const textLength = comment.text.length;
  let lengthBonus = 0;
  if (textLength >= 100 && textLength <= 500) lengthBonus = 10;
  else if (textLength > 500) lengthBonus = 25;

  return (likes * 3) + recencyBonus + lengthBonus;
}

/**
 * Select top N comments to reply to based on engagement
 */
function selectTopComments(comments: Comment[], maxCount: number): Comment[] {
  if (!comments || comments.length === 0) return [];

  const commentsWithScores = comments.map(comment => ({
    comment,
    score: calculateCommentScore(comment),
  }));

  // Sort by score descending
  commentsWithScores.sort((a, b) => b.score - a.score);

  // Return top N
  return commentsWithScores.slice(0, maxCount).map(c => c.comment);
}

export async function replyToYouTubeCommentsWorkflow(config: WorkflowConfig = {}) {
  const maxVideos = config.maxVideos || 5;
  const maxRepliesPerRun = config.maxRepliesPerRun || 3;
  const initialTimeWindow = config.timeWindowHours || 24;
  const isDryRun = config.dryRun || false;

  const initialContext: WorkflowContext = {
    videos: [],
    allComments: [],
    filteredComments: [],
    selectedComments: [],
    repliesData: [],
  };

  const pipeline = createPipeline<WorkflowContext>();

  const result = await pipeline
    .step('get-channel-id', async (ctx) => {
      logger.info('🔍 Getting channel ID');

      const channelId = config.channelId || await getOurChannelId();

      if (!channelId) {
        throw new Error('Could not determine channel ID');
      }

      logger.info({ channelId }, '✅ Got channel ID');
      return { ...ctx, channelId };
    })
    .step('fetch-recent-videos', async (ctx) => {
      if (!ctx.channelId) {
        throw new Error('Channel ID not set');
      }

      logger.info({ channelId: ctx.channelId, maxVideos }, '🎥 Fetching recent videos');

      // Try 24 hours first
      let publishedAfter = new Date(Date.now() - initialTimeWindow * 60 * 60 * 1000);
      let videos = await getRecentVideos(ctx.channelId, maxVideos, publishedAfter);

      // If no videos, extend to 48 hours
      if (videos.length === 0) {
        logger.info('No videos in last 24h, extending to 48h');
        publishedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000);
        videos = await getRecentVideos(ctx.channelId, maxVideos, publishedAfter);
      }

      logger.info({ count: videos.length }, '✅ Found videos');
      return { ...ctx, videos };
    })
    .step('fetch-comments', async (ctx) => {
      logger.info({ videoCount: ctx.videos.length }, '💬 Fetching comments from videos');

      const allComments: Comment[] = [];

      // Fetch comments from each video
      for (const video of ctx.videos) {
        const videoId = video.id?.videoId;
        const videoTitle = video.snippet?.title || 'Unknown';

        if (!videoId) continue;

        try {
          const commentThreads = await getVideoComments(videoId, 50);

          // Extract top-level comments only
          for (const thread of commentThreads) {
            const comment = thread.snippet?.topLevelComment;
            if (!comment || !comment.snippet) continue;

            allComments.push({
              id: comment.id || '',
              videoId,
              videoTitle,
              text: comment.snippet.textDisplay || '',
              authorDisplayName: comment.snippet.authorDisplayName || '',
              authorChannelId: comment.snippet.authorChannelId?.value || '',
              likeCount: comment.snippet.likeCount || 0,
              publishedAt: comment.snippet.publishedAt || new Date().toISOString(),
            });
          }
        } catch (error) {
          logger.warn({ error, videoId }, 'Failed to fetch comments for video');
        }
      }

      logger.info({ count: allComments.length }, '✅ Fetched all comments');
      return { ...ctx, allComments };
    })
    .step('filter-already-replied', async (ctx) => {
      logger.info({ totalComments: ctx.allComments.length }, '🔍 Checking for already-replied comments');

      if (ctx.allComments.length === 0) {
        return { ...ctx, filteredComments: [] };
      }

      // Get all comment IDs
      const commentIds = ctx.allComments.map(c => c.id);

      // Query database for comments we've already replied to
      const repliedCommentIds: string[] = [];

      if (useSQLite) {
        const repliedComments = await (db as ReturnType<typeof import('drizzle-orm/better-sqlite3').drizzle>)
          .select({ originalCommentId: youtubeCommentRepliesTableSQLite.originalCommentId })
          .from(youtubeCommentRepliesTableSQLite)
          .where(inArray(youtubeCommentRepliesTableSQLite.originalCommentId, commentIds));

        repliedCommentIds.push(...repliedComments.map(r => r.originalCommentId));
      } else {
        const repliedComments = await (db as ReturnType<typeof import('drizzle-orm/node-postgres').drizzle>)
          .select({ originalCommentId: youtubeCommentRepliesTablePostgres.originalCommentId })
          .from(youtubeCommentRepliesTablePostgres)
          .where(inArray(youtubeCommentRepliesTablePostgres.originalCommentId, commentIds));

        repliedCommentIds.push(...repliedComments.map(r => r.originalCommentId));
      }

      // Filter out already-replied comments
      const filtered = ctx.allComments.filter(c => !repliedCommentIds.includes(c.id));

      logger.info(
        { total: ctx.allComments.length, alreadyReplied: repliedCommentIds.length, remaining: filtered.length },
        `✅ Filtered out ${repliedCommentIds.length} already-replied comments`
      );

      return { ...ctx, filteredComments: filtered };
    })
    .step('filter-our-own-comments', async (ctx) => {
      if (!ctx.channelId) {
        throw new Error('Channel ID not set');
      }

      logger.info('🔍 Filtering out our own comments');

      // Filter out comments from our own channel
      const externalComments = ctx.filteredComments.filter(c => c.authorChannelId !== ctx.channelId);

      logger.info(
        { total: ctx.filteredComments.length, ours: ctx.filteredComments.length - externalComments.length, remaining: externalComments.length },
        '✅ Filtered out our own comments'
      );

      return { ...ctx, filteredComments: externalComments };
    })
    .step('select-top-comments', async (ctx) => {
      logger.info({ availableComments: ctx.filteredComments.length, maxReplies: maxRepliesPerRun }, '🎯 Selecting top comments');

      const selected = selectTopComments(ctx.filteredComments, maxRepliesPerRun);

      if (selected.length === 0) {
        logger.warn('No suitable comments found');
        throw new Error('No suitable comments found to reply to');
      }

      logger.info({ count: selected.length }, `✅ Selected ${selected.length} comments`);
      return { ...ctx, selectedComments: selected };
    })
    .step('generate-replies', async (ctx) => {
      logger.info({ count: ctx.selectedComments.length }, '🤖 Generating AI replies');

      const repliesData: Array<{
        comment: Comment;
        generatedReply: string;
        replyResult?: ReplyResult;
      }> = [];

      for (const comment of ctx.selectedComments) {
        try {
          // Generate reply using OpenAI (reuse tweet reply function)
          // Pass systemPrompt directly from config - frontend will provide it
          const prompt = `Video: "${comment.videoTitle}"\nComment by ${comment.authorDisplayName}: "${comment.text}"`;
          const generatedReply = await generateTweetReply(
            prompt,
            config.systemPrompt
          );

          repliesData.push({
            comment,
            generatedReply,
            replyResult: undefined, // Will be set in the next step
          });

          logger.info(
            { commentId: comment.id, replyLength: generatedReply.length },
            'Generated reply for comment'
          );
        } catch (error) {
          logger.error({ error, commentId: comment.id }, 'Failed to generate reply');
        }
      }

      logger.info({ count: repliesData.length }, '✅ Generated all replies');
      return { ...ctx, repliesData };
    })
    .step('post-replies', async (ctx) => {
      logger.info({ count: ctx.repliesData.length, isDryRun }, '📤 Posting replies to YouTube');

      const updatedRepliesData = [];

      for (const replyData of ctx.repliesData) {
        if (isDryRun) {
          logger.info(
            { commentId: replyData.comment.id, reply: replyData.generatedReply },
            '🧪 DRY RUN MODE - Skipping actual post to YouTube'
          );
          updatedRepliesData.push({
            ...replyData,
            replyResult: { dryRun: true, skipped: true },
          });
          continue;
        }

        try {
          const result = await replyToComment(replyData.comment.id, replyData.generatedReply);

          updatedRepliesData.push({
            ...replyData,
            replyResult: { id: result.id } as ReplyResult,
          });

          logger.info({ commentId: replyData.comment.id }, '✅ Reply posted');
        } catch (error) {
          logger.error({ error, commentId: replyData.comment.id }, 'Failed to post reply');
          updatedRepliesData.push({
            ...replyData,
            replyResult: { error: String(error) } as ReplyResult,
          });
        }
      }

      logger.info({ successCount: updatedRepliesData.filter(r => !r.replyResult?.error).length }, '✅ Finished posting replies');
      return { ...ctx, repliesData: updatedRepliesData };
    })
    .step('save-to-database', async (ctx) => {
      logger.info({ count: ctx.repliesData.length }, '💾 Saving replies to database');

      for (const replyData of ctx.repliesData) {
        try {
          const dbRecord: NewYouTubeCommentReply = {
            originalCommentId: replyData.comment.id,
            originalCommentText: replyData.comment.text,
            originalCommentAuthor: replyData.comment.authorDisplayName,
            originalCommentLikes: replyData.comment.likeCount,
            videoId: replyData.comment.videoId,
            videoTitle: replyData.comment.videoTitle,
            ourReplyText: replyData.generatedReply,
            ourReplyCommentId: isDryRun ? null : replyData.replyResult?.id || null,
            status: isDryRun ? 'pending' : (replyData.replyResult?.error ? 'failed' : 'posted'),
            repliedAt: isDryRun ? null : new Date(),
          };

          if (useSQLite) {
            await (db as ReturnType<typeof import('drizzle-orm/better-sqlite3').drizzle>)
              .insert(youtubeCommentRepliesTableSQLite)
              .values(dbRecord);
          } else {
            await (db as ReturnType<typeof import('drizzle-orm/node-postgres').drizzle>)
              .insert(youtubeCommentRepliesTablePostgres)
              .values(dbRecord);
          }

          logger.info({ commentId: replyData.comment.id }, 'Saved reply to database');
        } catch (error) {
          logger.error({ error, commentId: replyData.comment.id }, 'Failed to save reply to database');
        }
      }

      logger.info('✅ All replies saved to database');
      return ctx;
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .execute(initialContext as any);

  if (!result.success || !result.finalData) {
    const failedStep = result.results.find(r => !r.success);
    const errorMessage = failedStep?.error || 'Unknown pipeline error';
    throw new Error(`Workflow failed at step "${failedStep?.name}": ${errorMessage}`);
  }

  return result.finalData as WorkflowContext;
}
