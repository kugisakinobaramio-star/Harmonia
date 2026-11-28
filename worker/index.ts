import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createApp } from '../server';

const app = await createApp({
  mode: 'worker',
  youtubeDataApiKey: (env as unknown as { YOUTUBE_DATA_API_KEY?: string }).YOUTUBE_DATA_API_KEY,
});
app.listen(3000);

export default httpServerHandler({ port: 3000 });
