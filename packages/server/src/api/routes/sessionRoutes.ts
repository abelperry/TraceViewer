/**
 * REST 路由：列表/查询/全文。api 层只做协议与 DTO 映射，不含业务规则。
 */

import type { FastifyInstance } from 'fastify';
import type { SessionQueryService } from '../../application/service/SessionQueryService.js';
import { collectionToDTO, metaToDTO, sessionToDetailDTO } from '../dto/mappers.js';

interface Deps {
  query: SessionQueryService;
}

export async function registerRestRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { query } = deps;

  app.get('/collections', async () => {
    return query.listCollections().map(collectionToDTO);
  });

  app.get<{
    Querystring: { collectionId?: string; keyword?: string; limit?: string; offset?: string };
  }>('/sessions', async (req) => {
    const { collectionId, keyword, limit, offset } = req.query;
    const metas = await query.queryMetas({
      collectionId,
      keyword,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return metas.map(metaToDTO);
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const loaded = await query.loadDetail(req.params.id);
    if (!loaded) {
      reply.code(404);
      return { error: 'session not found' };
    }
    return sessionToDetailDTO(loaded.session, new Date());
  });

  app.post('/reindex', async () => {
    const count = await query.syncIndex();
    return { indexed: count };
  });
}
