// Match the OpenAI provider's OPENAI_BASE_URL override, including its /v1 prefix.
export const openAIEndpoint = (path, env = process.env) => `${(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/${path}`;
