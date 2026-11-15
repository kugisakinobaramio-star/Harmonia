import 'dotenv/config';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server';

const port = Number(process.env.PORT || 3000);
const app = await createApp();

if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Harmonia full-stack server running on http://localhost:${port}`);
});
