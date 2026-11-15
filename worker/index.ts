import { httpServerHandler } from 'cloudflare:node';
import { createApp } from '../server';

const app = await createApp({ mode: 'worker' });
app.listen(3000);

export default httpServerHandler({ port: 3000 });
