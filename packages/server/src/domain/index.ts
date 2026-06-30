// domain 内核统一出口。零框架依赖，可独立单测。
export * from './model/Block.js';
export * from './model/Event.js';
export * from './model/TokenUsage.js';
export * from './model/SessionMeta.js';
export * from './model/Session.js';
export * from './model/DailyStat.js';
export * from './port/SourceAdapter.js';
export * from './port/SessionRepository.js';
export * from './port/TraceSource.js';
export * from './port/StatisticRepository.js';
export * from './service/TranscriptAssembler.js';
export * from './service/StatisticAggregator.js';
