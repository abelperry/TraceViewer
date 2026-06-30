/**
 * SSE 路由：实时增量推送。
 *
 * 客户端 GET /sessions/:id/stream，服务端先回放一次全文（init 事件），
 * 之后通过 LiveStreamService 订阅，每次增量推一个 patch 事件。
 * 连接关闭时取消订阅（引用计数归零则停止该会话 tail）。
 */

import type { FastifyInstance } from 'fastify';
import type { SessionQueryService } from '../../application/service/SessionQueryService.js';
import type { LiveStreamService } from '../../application/service/LiveStreamService.js';
import { sessionToDetailDTO } from '../dto/mappers.js';

interface Deps {
  query: SessionQueryService;
  live: LiveStreamService;
}

export async function registerStreamRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { query, live } = deps;

  app.get<{ Params: { id: string } }>('/sessions/:id/stream', async (req, reply) => {
    const sessionId = req.params.id;
    const loaded = await query.loadDetail(sessionId);
    if (!loaded) {
      reply.code(404);
      return reply.send({ error: 'session not found' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 1) 先回放一次全文快照
    send('init', sessionToDetailDTO(loaded.session, new Date()));

    // 2) 订阅增量
    const unsubscribe = await live.subscribe(sessionId, (patch) => {
      send('patch', patch);
    });

    // 心跳，保活并探测断连
    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    });
  });
}
