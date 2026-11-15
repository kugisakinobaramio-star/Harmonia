import { httpServerHandler } from 'cloudflare:node';
import { createApp } from '../server';

const app = await createApp({ mode: 'worker' });
app.listen(8787);

export default httpServerHandler({ port: 8787 });
