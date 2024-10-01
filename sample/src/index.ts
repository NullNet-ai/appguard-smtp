import { SMTPServer } from '@nullnet/app-guard-smtp';

const { PORT = '2526' } = process.env;

async function bootstrap() {
  const server = new SMTPServer(+PORT, "localhost", 50051);
  await server.onModuleInit();

  console.log(`SMTP Server is running on port ${+PORT}`);
}

bootstrap();
