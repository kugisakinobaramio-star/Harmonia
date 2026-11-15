import 'dotenv/config';
import { createApp } from './server';

const port = Number(process.env.PORT || 3000);
const app = await createApp();
app.listen(port, '0.0.0.0', () => {
  console.log(`Harmonia full-stack server running on http://localhost:${port}`);
});
