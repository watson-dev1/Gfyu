
import config from '../config.js';

export async function askAI(prompt, history = []) {
  const apiKey = config.aiApiKey;

  const endpoint = config.aiApiUrl;
  const model = config.aiModel;

  if (!apiKey) {
    throw new Error(
      'AI is not configured. Add AI_API_KEY to your environment variables.'
    );
  }

  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Please provide a question.');
  }

  const safeHistory = Array.isArray(history)
    ? history.slice(-10).filter(item =>
        item &&
        ['user', 'assistant'].includes(item.role) &&
        typeof item.content === 'string' &&
        item.content.trim()
      )
    : [];

  const messages = [
    {
      role: 'system',
      content:
        `You are Watson AI, the assistant inside PRECIOUS-MD WhatsApp bot. ` +
        `The bot was created by Watson Fourpence. ` +
        `Be helpful, accurate, respectful and concise. ` +
        `Respond in the language used by the user, including Shona when appropriate. ` +
        `Do not claim to have performed actions you cannot perform.`
    },
    ...safeHistory,
    {
      role: 'user',
      content: prompt.slice(0, 8000)
    }
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1000
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    throw new Error(
      `AI provider returned HTTP ${response.status}: ${detail.slice(0, 300)}`
    );
  }

  const data = await response.json();

  const answer = data.choices?.[0]?.message?.content;

  if (typeof answer !== 'string' || !answer.trim()) {
    throw new Error('The AI provider returned an empty response.');
  }

  return answer.trim().slice(0, 12000);
}
