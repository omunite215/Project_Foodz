import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';
import { handleAuthRequest } from '@/server/auth/gateway';

const handlers = toNextJsHandler(auth);

export const GET = (request: Request) => handleAuthRequest(request, handlers.GET);
export const POST = (request: Request) => handleAuthRequest(request, handlers.POST);
