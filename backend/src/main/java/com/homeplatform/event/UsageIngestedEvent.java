package com.homeplatform.event;

/**
 * Published by an ingestion scheduler (daily or hourly CoServ sync, scheduled or
 * manually triggered from the Debug Dashboard) right after a sync attempt completes.
 * Decouples ingestion from downstream consumers — e.g. {@code ForecastScheduler}
 * reacts by checking for new actuals to backfill/retrain on — so a new ingestion
 * path gets that reactivity for free just by publishing this event, instead of the
 * scheduler needing a direct reference to every interested consumer.
 *
 * <p>Cheap to publish liberally: listeners are expected to no-op when nothing
 * actually changed (e.g. a sync attempt that found no new data yet).
 */
public record UsageIngestedEvent(String source) {
}
