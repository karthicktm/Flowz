import OpenAI from 'openai';
import { createOpenAICircuitBreaker } from './resilience';
import { openaiRateLimiter, withRateLimit } from './rate-limiter';
import { logger } from './logger';
import { db } from './db';
import { appSettingsTable } from './schema';
import { eq } from 'drizzle-orm';

/**
 * OpenAI API Client with Reliability Infrastructure
 *
 * Features:
 * - Circuit breaker to prevent hammering failing API
 * - Rate limiting (500 req/min)
 * - Structured logging
 * - 60s timeout for AI generation
 */

if (!process.env.OPENAI_API_KEY) {
  logger.warn('⚠️  OPENAI_API_KEY is not set. OpenAI features will not work.');
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  timeout: 60000, // 60 second timeout
});

/**
 * Get the selected OpenAI model from database settings
 * Falls back to gpt-4o-mini if not set
 */
async function getSelectedModel(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = await (db as any)
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, 'openai_model'))
      .limit(1);

    return settings[0]?.value || 'gpt-4o-mini';
  } catch (error) {
    logger.warn({ error }, 'Failed to fetch model setting from database, using default');
    return 'gpt-4o-mini';
  }
}

async function generateTweetInternal(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  logger.info({ promptLength: prompt.length, hasSystemPrompt: !!systemPrompt }, 'Generating tweet with AI');

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  // Only add system prompt if provided by caller
  // Append technical requirement to whatever prompt they provide
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: `${systemPrompt}\n\nCRITICAL: Keep tweets under 280 characters.`,
    });
  }

  messages.push({
    role: 'user',
    content: prompt,
  });

  const model = await getSelectedModel();

  // GPT-5 models don't support any optional parameters (temperature, max_tokens, etc)
  // Only GPT-4o models support these parameters
  const isGPT5 = model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3');

  const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    ...(isGPT5
      ? {} // No optional parameters for GPT-5
      : { max_tokens: 500, temperature: 0.8 }
    ),
  };

  const completion = await openai.chat.completions.create(completionParams);

  const result = completion.choices[0]?.message?.content || '';
  logger.info({ resultLength: result.length }, 'Tweet generated successfully');
  return result;
}

/**
 * Generate tweet (protected with circuit breaker + rate limiting)
 *
 * @param prompt - The user's prompt describing what to tweet about
 * @param systemPrompt - Optional custom system prompt to control tone/style
 */
const generateTweetWithBreaker = createOpenAICircuitBreaker(generateTweetInternal);
export const generateTweet = withRateLimit(
  (prompt: string, systemPrompt?: string) => generateTweetWithBreaker.fire(prompt, systemPrompt),
  openaiRateLimiter
);

/**
 * Generate a thread of tweets (internal, unprotected)
 *
 * @param prompt - The user's prompt describing what the thread should be about
 * @param threadLength - Number of tweets in the thread (2-10)
 * @param systemPrompt - Optional custom system prompt
 * @returns Array of tweet strings, each under 280 characters
 */
async function generateThreadInternal(
  prompt: string,
  threadLength: number = 3,
  systemPrompt?: string
): Promise<string[]> {
  logger.info(
    { promptLength: prompt.length, threadLength, hasSystemPrompt: !!systemPrompt },
    'Generating thread with AI'
  );

  // CRITICAL: Always append formatting instructions - these are technical requirements
  const formattingInstructions = `

IMPORTANT FORMATTING RULES:
- You MUST generate EXACTLY ${threadLength} separate tweets
- Each tweet MUST be under 280 characters
- Return ONLY the tweets separated by "---" (three dashes on a new line)
- Do NOT return a single long tweet - split it into ${threadLength} distinct tweets

Example format:
First tweet text here (under 280 chars)

---

Second tweet text here (under 280 chars)

---

Third tweet text here (under 280 chars)`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  // Only add system prompt if provided by caller
  // Always append formatting instructions
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: `${systemPrompt}${formattingInstructions}`,
    });
  }

  messages.push({
    role: 'user',
    content: prompt,
  });

  const model = await getSelectedModel();

  // GPT-5 models don't support any optional parameters (temperature, max_tokens, etc)
  // Only GPT-4o models support these parameters
  const isGPT5 = model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3');

  const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    ...(isGPT5
      ? {} // No optional parameters for GPT-5
      : { max_tokens: 1000, temperature: 0.8 }
    ),
  };

  const completion = await openai.chat.completions.create(completionParams);

  const result = completion.choices[0]?.message?.content || '';

  // Log raw AI response for debugging
  logger.info({ rawResponse: result.substring(0, 500) }, 'Raw AI thread response (first 500 chars)');

  // Split the result by "---" separator (handle various formats)
  // Try multiple parsing strategies:
  let tweets: string[] = [];

  // Strategy 1: Split by "---" with flexible whitespace
  if (result.includes('---')) {
    tweets = result
      .split(/\s*---\s*/)
      .map(tweet => tweet.trim())
      .filter(tweet => tweet.length > 0 && tweet.length <= 280);
  }

  // Strategy 2: If no separator found, try splitting by double newlines
  if (tweets.length === 0 && result.includes('\n\n')) {
    tweets = result
      .split(/\n\n+/)
      .map(tweet => tweet.trim())
      .filter(tweet => tweet.length > 0 && tweet.length <= 280);
  }

  // Strategy 3: If still no tweets, try splitting by numbered list (1., 2., 3.)
  if (tweets.length === 0 && /^\d+\.\s/.test(result)) {
    tweets = result
      .split(/\n\d+\.\s/)
      .map(tweet => tweet.trim())
      .filter(tweet => tweet.length > 0 && tweet.length <= 280);
    // Remove potential leading number from first tweet
    if (tweets.length > 0 && /^\d+\.\s/.test(tweets[0])) {
      tweets[0] = tweets[0].replace(/^\d+\.\s/, '').trim();
    }
  }

  // Strategy 4: Last resort - treat entire response as single tweet if it's valid
  if (tweets.length === 0 && result.trim().length > 0 && result.trim().length <= 280) {
    tweets = [result.trim()];
  }

  // Log parsed tweets for debugging
  logger.info({ parsedCount: tweets.length, tweets: tweets.slice(0, 3) }, 'Parsed tweets from AI response');

  // Validate we got the right number of tweets
  if (tweets.length < threadLength) {
    logger.warn(
      { expected: threadLength, received: tweets.length },
      'Generated fewer tweets than requested, padding with available tweets'
    );
  }

  // Take exactly threadLength tweets (or all if fewer were generated)
  const finalTweets = tweets.slice(0, threadLength);

  logger.info(
    { tweetCount: finalTweets.length, lengths: finalTweets.map(t => t.length) },
    'Thread generated successfully'
  );

  return finalTweets;
}

/**
 * Generate a thread of tweets (protected with circuit breaker + rate limiting)
 *
 * @param prompt - The user's prompt describing what the thread should be about
 * @param threadLength - Number of tweets in the thread (2-10)
 * @param systemPrompt - Optional custom system prompt
 * @returns Array of tweet strings
 */
const generateThreadWithBreaker = createOpenAICircuitBreaker(generateThreadInternal);
export const generateThread = withRateLimit(
  (prompt: string, threadLength?: number, systemPrompt?: string) =>
    generateThreadWithBreaker.fire(prompt, threadLength, systemPrompt),
  openaiRateLimiter
);

async function generateTweetReplyInternal(
  originalTweet: string,
  systemPrompt?: string
): Promise<string> {
  logger.info(
    { originalTweetLength: originalTweet.length, hasSystemPrompt: !!systemPrompt },
    'Generating tweet reply with AI'
  );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  // Only add system prompt if provided by caller
  // Append technical requirement to whatever prompt they provide
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: `${systemPrompt}\n\nCRITICAL: Keep your reply under 280 characters.`,
    });
  }

  messages.push({
    role: 'user',
    content: `Generate a reply to this tweet:\n\n"${originalTweet}"`,
  });

  const model = await getSelectedModel();

  // GPT-5 models don't support any optional parameters (temperature, max_tokens, etc)
  // Only GPT-4o models support these parameters
  const isGPT5 = model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3');

  const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    ...(isGPT5
      ? {} // No optional parameters for GPT-5
      : { max_tokens: 100, temperature: 0.7 }
    ),
  };

  const completion = await openai.chat.completions.create(completionParams);

  const result = completion.choices[0]?.message?.content || '';
  logger.info({ replyLength: result.length }, 'Tweet reply generated successfully');
  return result;
}

/**
 * Generate tweet reply (protected with circuit breaker + rate limiting)
 */
const generateTweetReplyWithBreaker = createOpenAICircuitBreaker(generateTweetReplyInternal);
export const generateTweetReply = withRateLimit(
  (originalTweet: string, systemPrompt?: string) =>
    generateTweetReplyWithBreaker.fire(originalTweet, systemPrompt),
  openaiRateLimiter
);
