import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ENV } from '../config/env.module';
import { type ApiEnv } from '../config/env';
import { EVENT_BUS, type EventBusPort } from './event-bus.port';
import { EventsModule } from './events.module';

/**
 * The first acceptance criterion of card F-10: one module publishes an event
 * and another reacts to it, with no import between the two.
 *
 * The two modules below stand in for `nutrition` and `insights`, which are
 * still empty — the real publisher arrives with the card that writes the use
 * case. What is proved here is the wiring they will use: each one imports
 * `EventsModule` and asks for `EVENT_BUS`, and neither one names the other.
 * Rule 1 itself (nobody reaches into another module's folder) is lint's job,
 * and `packages/config/test/module-boundaries.test.js` covers it.
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: 'unused-in-this-test-but-long-enough-0001',
  corsAllowedOrigins: [],
  logLevel: 'silent',
};

/** The publisher: what a use case of `nutrition` will look like. */
@Injectable()
class ActivatePlanUseCase {
  constructor(@Inject(EVENT_BUS) private readonly events: EventBusPort) {}

  async execute(planId: string, patientId: string): Promise<void> {
    await this.events.publish('nutrition.plan.activated', {
      planId,
      patientId,
      activatedAt: '2026-10-14T12:00:00.000Z',
    });
  }
}

@Module({
  imports: [EventsModule],
  providers: [ActivatePlanUseCase],
  exports: [ActivatePlanUseCase],
})
class PublishingModule {}

/** The subscriber: what a listener of `insights` will look like. */
@Injectable()
class ReviewAlertRulesListener implements OnApplicationBootstrap {
  readonly reactedTo: string[] = [];

  constructor(@Inject(EVENT_BUS) private readonly events: EventBusPort) {}

  onApplicationBootstrap(): void {
    this.events.subscribe('nutrition.plan.activated', ({ planId }) => {
      this.reactedTo.push(planId);
    });
  }
}

@Module({
  imports: [EventsModule],
  providers: [ReviewAlertRulesListener],
  exports: [ReviewAlertRulesListener],
})
class ReactingModule {}

describe('an event crossing a module boundary', () => {
  it('reaches the other module, which never imported the publisher', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PublishingModule, ReactingModule],
    })
      .overrideProvider(ENV)
      .useValue(env)
      .compile();

    // `init()` is what runs `onApplicationBootstrap`, which is where the
    // reacting module subscribes.
    const app = await moduleRef.createNestApplication().init();

    try {
      await app.get(ActivatePlanUseCase).execute('plan-7', 'patient-7');

      expect(app.get(ReviewAlertRulesListener).reactedTo).toEqual(['plan-7']);
    } finally {
      await app.close();
    }
  });
});
