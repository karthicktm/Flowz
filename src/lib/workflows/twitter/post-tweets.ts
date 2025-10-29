import { createPipeline } from '../Pipeline';
import { createTweet, createThread } from '@/lib/twitter';
import { generateTweet, generateThread } from '@/lib/openai';
import { logger } from '@/lib/logger';
import { db, useSQLite } from '@/lib/db';
import { tweetsTableSQLite, tweetsTablePostgres, postedNewsArticlesTableSQLite, postedNewsArticlesTablePostgres } from '@/lib/schema';
import { trackPost, trackRead } from '@/lib/usage-tracker';
import { getNewsSummaryForAI, type NewsArticle } from '@/lib/rapidapi/newsapi';

/**
 * Post Tweets Workflow
 *
 * Production-ready with:
 * - Automatic retries (Twitter: 3 attempts, OpenAI: 3 attempts)
 * - Circuit breakers to prevent hammering failing APIs
 * - Rate limiting (Twitter: 50 actions/hour, OpenAI: 500 req/min)
 * - Structured logging to logs/app.log
 * - Thread support (can post multiple tweets as a thread)
 *
 * Steps:
 * 1. Generate tweet content with AI
 * 2. Validate tweet (length, content)
 * 3. Post to Twitter (single tweet or thread)
 * 4. Save to database
 */

interface WorkflowContext {
  prompt: string;
  systemPrompt?: string;
  isThread?: boolean;
  useNewsResearch?: boolean;
  newsTopic?: string;
  newsLanguage?: string;
  newsCountry?: string;
  newsContext?: string;
  selectedArticle?: NewsArticle | null;
  generatedTweets: string[];
  postedTweetIds: string[];
}

interface WorkflowConfig {
  prompt: string;
  systemPrompt?: string;
  isThread?: boolean; // If true, generate multiple tweets as a thread
  threadLength?: number; // Number of tweets in thread (2-10)
  useNewsResearch?: boolean; // If true, fetch latest news for context
  newsTopic?: string; // News topic to research (e.g., 'technology', 'business')
  newsLanguage?: string; // News language (e.g., 'en', 'es')
  newsCountry?: string; // News country (e.g., 'us', 'gb')
  dryRun?: boolean; // If true, skip posting to Twitter
}

/**
 * Validate tweet text
 * - Must not be empty
 * - Must be under 280 characters
 */
function validateTweet(text: string): { valid: boolean; error?: string } {
  if (!text || text.trim().length === 0) {
    return { valid: false, error: 'Tweet cannot be empty' };
  }

  if (text.length > 280) {
    return { valid: false, error: `Tweet is too long (${text.length}/280 characters)` };
  }

  return { valid: true };
}

export async function postTweetsWorkflow(config: WorkflowConfig) {
  const initialContext: WorkflowContext = {
    prompt: config.prompt,
    systemPrompt: config.systemPrompt,
    isThread: config.isThread || false,
    useNewsResearch: config.useNewsResearch || false,
    newsTopic: config.newsTopic,
    newsLanguage: config.newsLanguage || 'en',
    newsCountry: config.newsCountry || 'us',
    generatedTweets: [],
    postedTweetIds: [],
  };

  const isDryRun = config.dryRun || false;
  const threadLength = config.threadLength || 3;

  const pipeline = createPipeline<WorkflowContext>();

  const result = await pipeline
    .step('research-news', async (ctx) => {
      // Skip if news research is not enabled
      if (!ctx.useNewsResearch) {
        logger.info('📰 News research disabled, skipping');
        return ctx;
      }

      logger.info(
        {
          topic: ctx.newsTopic,
          language: ctx.newsLanguage,
          country: ctx.newsCountry,
        },
        '📰 Researching latest news'
      );

      // Load already-posted article URLs to exclude them
      let excludeUrls: string[] = [];
      if (useSQLite) {
        const posted = await (db as ReturnType<typeof import('drizzle-orm/better-sqlite3').drizzle>)
          .select({ articleUrl: postedNewsArticlesTableSQLite.articleUrl })
          .from(postedNewsArticlesTableSQLite);
        excludeUrls = posted.map(p => p.articleUrl);
      } else {
        const posted = await (db as ReturnType<typeof import('drizzle-orm/node-postgres').drizzle>)
          .select({ articleUrl: postedNewsArticlesTablePostgres.articleUrl })
          .from(postedNewsArticlesTablePostgres);
        excludeUrls = posted.map(p => p.articleUrl);
      }

      logger.info({ excludeCount: excludeUrls.length }, 'Loaded already-posted articles');

      const { summary, selectedArticle } = await getNewsSummaryForAI({
        topic: ctx.newsTopic,
        language: ctx.newsLanguage,
        country: ctx.newsCountry,
        limit: 5,
        excludeUrls,
      });

      // Track news API usage
      await trackRead();

      if (!selectedArticle) {
        throw new Error('No new articles found - all trending articles have already been posted about');
      }

      logger.info(
        {
          articleTitle: selectedArticle.title,
          articleUrl: selectedArticle.url,
        },
        '✅ News research completed - selected new article'
      );

      return { ...ctx, newsContext: summary, selectedArticle };
    })
    .step('generate-tweet', async (ctx) => {
      logger.info(
        {
          prompt: ctx.prompt,
          isThread: ctx.isThread,
          hasSystemPrompt: !!ctx.systemPrompt,
          hasNewsContext: !!ctx.newsContext,
        },
        '🤖 Generating tweet content with AI'
      );

      // If we have news context, prepend it to the prompt
      let fullPrompt = ctx.prompt;
      if (ctx.newsContext) {
        fullPrompt = `${ctx.newsContext}\n\nBased on the above news, ${ctx.prompt}`;
      }

      let tweets: string[];

      if (ctx.isThread) {
        // Pass systemPrompt directly from config - frontend will provide it
        tweets = await generateThread(fullPrompt, threadLength, ctx.systemPrompt);
        logger.info({ tweetCount: tweets.length }, `✅ Generated thread with ${tweets.length} tweets`);
      } else {
        // Pass systemPrompt directly from config - frontend will provide it
        const generatedText = await generateTweet(fullPrompt, ctx.systemPrompt);
        tweets = [generatedText];
        logger.info({ tweetLength: generatedText.length }, '✅ Generated single tweet');
      }

      return { ...ctx, generatedTweets: tweets };
    })
    .step('validate-tweets', async (ctx) => {
      logger.info({ tweetCount: ctx.generatedTweets.length }, '🔍 Validating tweets');

      for (let i = 0; i < ctx.generatedTweets.length; i++) {
        const tweet = ctx.generatedTweets[i];
        const validation = validateTweet(tweet);

        if (!validation.valid) {
          throw new Error(`Tweet ${i + 1} validation failed: ${validation.error}`);
        }
      }

      logger.info('✅ All tweets validated');
      return ctx;
    })
    .step('post-tweets', async (ctx): Promise<WorkflowContext> => {
      if (!ctx.generatedTweets || ctx.generatedTweets.length === 0) {
        throw new Error('No tweets to post');
      }

      if (isDryRun) {
        logger.info(
          {
            tweetCount: ctx.generatedTweets.length,
            tweets: ctx.generatedTweets,
          },
          '🧪 DRY RUN MODE - Skipping actual post to Twitter'
        );
        return { ...ctx, postedTweetIds: [] };
      }

      logger.info({ tweetCount: ctx.generatedTweets.length }, '📤 Posting to Twitter');

      // If single tweet, use createTweet
      if (ctx.generatedTweets.length === 1) {
        const result = await createTweet(ctx.generatedTweets[0]);
        await trackPost();

        logger.info({ tweetId: result.id }, '✅ Tweet posted successfully');
        return { ...ctx, postedTweetIds: [result.id] };
      }

      // If multiple tweets, post as thread
      const tweetIds = await createThread(ctx.generatedTweets);

      // Track each tweet in the thread
      for (let i = 0; i < tweetIds.length; i++) {
        await trackPost();
      }

      logger.info(
        { threadLength: tweetIds.length, tweetIds },
        '✅ Thread posted successfully'
      );

      return { ...ctx, postedTweetIds: tweetIds };
    })
    .step('save-to-database', async (ctx): Promise<WorkflowContext> => {
      logger.info({ tweetCount: ctx.generatedTweets.length }, '💾 Saving tweets to database');

      for (let i = 0; i < ctx.generatedTweets.length; i++) {
        const tweetText = ctx.generatedTweets[i];
        const tweetId = ctx.postedTweetIds[i] || null;

        const tweetData = {
          content: tweetText,
          tweetId: tweetId,
          status: isDryRun ? 'draft' : 'posted',
          postedAt: isDryRun ? null : new Date(),
        };

        if (useSQLite) {
          await (db as ReturnType<typeof import('drizzle-orm/better-sqlite3').drizzle>)
            .insert(tweetsTableSQLite)
            .values(tweetData);
        } else {
          await (db as ReturnType<typeof import('drizzle-orm/node-postgres').drizzle>)
            .insert(tweetsTablePostgres)
            .values(tweetData);
        }

        logger.info(
          { tweetId, tweetNumber: i + 1, totalTweets: ctx.generatedTweets.length },
          `💾 Tweet ${i + 1}/${ctx.generatedTweets.length} saved to database`
        );
      }

      logger.info('✅ All tweets saved to database');
      return ctx;
    })
    .step('save-article-tracking', async (ctx): Promise<WorkflowContext> => {
      // Only save article tracking if we used news research and successfully posted
      if (!ctx.useNewsResearch || !ctx.selectedArticle || ctx.postedTweetIds.length === 0) {
        logger.info('📰 Skipping article tracking (no news research or no posts)');
        return ctx;
      }

      if (isDryRun) {
        logger.info('🧪 DRY RUN MODE - Skipping article tracking');
        return ctx;
      }

      logger.info({ articleUrl: ctx.selectedArticle.url }, '💾 Saving posted article to tracking database');

      const articleData = {
        articleUrl: ctx.selectedArticle.url,
        articleTitle: ctx.selectedArticle.title,
        articleSource: ctx.selectedArticle.publisher.name,
        articleDate: ctx.selectedArticle.date,
        newsTopic: ctx.newsTopic || null,
        threadTweetIds: JSON.stringify(ctx.postedTweetIds),
        postedAt: new Date(),
      };

      try {
        if (useSQLite) {
          await (db as ReturnType<typeof import('drizzle-orm/better-sqlite3').drizzle>)
            .insert(postedNewsArticlesTableSQLite)
            .values(articleData);
        } else {
          await (db as ReturnType<typeof import('drizzle-orm/node-postgres').drizzle>)
            .insert(postedNewsArticlesTablePostgres)
            .values(articleData);
        }

        logger.info('✅ Article tracking saved - will not repost this article');
      } catch (error) {
        // If unique constraint fails, it means we already tracked this article
        // This is OK, just log and continue
        logger.warn({ error, articleUrl: ctx.selectedArticle.url }, 'Article already tracked (duplicate)');
      }

      return ctx;
    })
    .execute(initialContext);

  if (!result.success || !result.finalData) {
    const failedStep = result.results.find(r => !r.success);
    const errorMessage = failedStep?.error || 'Unknown pipeline error';
    throw new Error(`Workflow failed at step "${failedStep?.name}": ${errorMessage}`);
  }

  return result.finalData as WorkflowContext;
}
