import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS for same-origin requests
  app.enableCors({
    origin: ['http://localhost', 'http://localhost:5173', 'http://localhost:80'],
    credentials: true,
  });

  // Set global prefix
  app.setGlobalPrefix('reviews');

  const port = process.env.PORT || 3003;
  await app.listen(port);
  console.log(`Reviews service running on port ${port}`);
}

bootstrap();
