import { SMTPServer, AppGuardConfig, FirewallPolicy } from '@nullnet/app-guard-smtp';

const { PORT = '2526' } = process.env;

async function bootstrap() {
  const appGuardConfig: AppGuardConfig = {
    host: 'localhost',
    port: 50051,
    timeoutMsec: 1_000,
    defaultPolicy: FirewallPolicy.ALLOW
  }

  const server = new SMTPServer(+PORT, appGuardConfig);
  await server.onModuleInit();

  console.log(`SMTP Server is running on port ${+PORT}`);
}

bootstrap();
