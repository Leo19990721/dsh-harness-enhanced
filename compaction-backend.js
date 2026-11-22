// The preset keeps its own compaction realm, /compact command and native pruner.
// This small entry point can start the stock backend even if the policy fails to load.
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic';

export const name = 'harness-enhanced-compaction';
export const inject = ['llm', 'sessions', 'tokenMeter', 'agents'];

export async function apply(ctx, { enhanced = true, ...config } = {}) {
  let policy;
  let manual;
  let backend;
  try {
    if (enhanced && config.auto !== false) {
      const [{ installCompaction }, llmApi, sessionApi, compactionApi, { SUMMARY_CAP }] = await Promise.all([
        import('./compaction.js'), import('@deepseek-ai/dsh-llm'), import('@deepseek-ai/dsh-session'),
        import('@deepseek-ai/dsh-compaction'), import('./compaction-policy.js'),
      ]);
      // The native command and registry still see the stock engine and its
      // original manual settings. Only the automatic summary has a smaller cap.
      manual = ctx.plugin(BasicCompactionEngine, { ...config, auto: false });
      await manual;
      backend = ctx.isolate('compaction').plugin(BasicCompactionEngine, { auto: false, maxTokens: SUMMARY_CAP });
      await backend;
      const engine = backend.ctx.get('compaction');
      if (!engine) throw new Error('automatic compaction engine unavailable');
      policy = ctx.plugin({
        name: 'harness-enhanced-compaction-policy',
        apply(scope) { installCompaction(scope, { engine, llmApi, sessionApi, compactionApi }); },
      });
      await policy;
      return;
    }
  } catch {
    await policy?.dispose();
    await backend?.dispose();
    await manual?.dispose();
    ctx.logger.warn('harness-enhanced-compaction: 新策略未能启动，使用原生压缩。');
  }
  await ctx.plugin(BasicCompactionEngine, config);
}
