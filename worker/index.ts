import { httpServerHandler } from 'cloudflare:node';
import { createApp } from '../server';

// The Cloudflare Worker runs the same Express API as the Node deployment.
// Static frontend files are served by Workers Static Assets before requests reach this handler.
const app = await createApp({ mode: 'worker' });
app.listen(8787);

export default httpServerHandler({ port: 8787 });
