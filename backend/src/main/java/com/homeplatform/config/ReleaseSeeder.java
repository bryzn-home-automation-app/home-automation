package com.homeplatform.config;

import com.homeplatform.model.AppRelease;
import com.homeplatform.model.ReleaseChange;
import com.homeplatform.repository.AppReleaseRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/**
 * Seeds the {@code app_releases} table from the code-authored history below.
 * Release notes are hand-written in plain language for the whole household; this
 * class is the source of truth. On each startup it upserts every entry by version
 * (insert if new, refresh the fields if the wording changed), so the DB always
 * mirrors what's committed here.
 *
 * <p>To cut a new version: prepend a {@link #define} entry to {@link #HISTORY}
 * (newest first). Display order is assigned automatically from list position, so
 * it never depends on string-comparing semantic versions.
 */
@Component
@Profile("!test")
public class ReleaseSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(ReleaseSeeder.class);

    private final AppReleaseRepository repository;

    public ReleaseSeeder(AppReleaseRepository repository) {
        this.repository = repository;
    }

    /** Newest release first. */
    private static final List<AppRelease> HISTORY = List.of(
            define("1.1.2", "stable", LocalDate.of(2026, 8, 25),
                    "Clean your way",
                    "Start a clean exactly how you want it — the whole house or just the rooms "
                            + "you pick, at the strength and number of passes you choose.",
                    List.of(
                            change("new", "New “Clean” option in the robot controls: choose the whole "
                                    + "house or hand-pick specific rooms, then set the suction strength, number "
                                    + "of passes, and (on the combo robot) vacuum / mop / both before it sets off."),
                            change("improved", "The robot returns to its dock automatically when the clean is "
                                    + "done, same as always."))),
            define("1.1.1", "stable", LocalDate.of(2026, 8, 24),
                    "Smoother pop-ups",
                    "A quick follow-up to v1.1.0 that makes the app's pop-up windows feel snappy.",
                    List.of(
                            change("fixed", "Editing your profile — changing your accent color or adding a "
                                    + "photo — is smooth again; the pop-up no longer lags or stutters."),
                            change("fixed", "Other pop-up windows (maintenance, Wi‑Fi, and the admin tools) "
                                    + "open and respond more smoothly too."))),
            define("1.1.0", "stable", LocalDate.of(2026, 8, 24),
                    "Faster and smoother",
                    "A big tune-up under the hood: the whole app feels quicker and lighter, the "
                            + "live vacuum map stays smooth while it cleans, and the home screen now "
                            + "welcomes you by name.",
                    List.of(
                            change("improved", "The app feels noticeably faster. It now does far less "
                                    + "background work, so screens and charts respond more quickly and "
                                    + "scrolling stays smooth."),
                            change("improved", "The home screen greets you by name and loads lighter — "
                                    + "it no longer pulls in data it doesn’t need just to show the summary."),
                            change("improved", "Watching the robot vacuum clean is much smoother now, "
                                    + "especially in homes with lots of mapped rooms."),
                            change("improved", "Switching between light and dark mode — or changing the "
                                    + "accent color — is now instant, with no flicker across the page."),
                            change("improved", "Scrolling on a phone is smoother; the bottom menu bar no "
                                    + "longer causes stutter."),
                            change("improved", "Long lists like notifications stay responsive while you "
                                    + "type to search or as new alerts arrive."),
                            change("fixed", "Fixed a rare glitch where the usage charts could fail to "
                                    + "appear right after opening a page."))),
            define("1.0.0", "beta", LocalDate.of(2026, 8, 22),
                    "Welcome to HomeOS",
                    "The first release of our home dashboard — one place to see the house at a glance, "
                            + "keep an eye on utilities, and run the robot vacuum.",
                    List.of(
                            change("new", "Electricity tracking: see how much power the house is using day to "
                                    + "day, compared against the weather so you can tell why a day was high or low."),
                            change("new", "Monthly bill estimate: a running guess at where this month’s electric "
                                    + "bill is headed, so there are no surprises."),
                            change("new", "Gas and water tabs: the same day-to-day view for the other utilities."),
                            change("new", "Robot vacuum: watch it move around the house live on the floor plan, see "
                                    + "a history of past cleanings, and send it to clean a single room with the "
                                    + "settings you want."),
                            change("new", "Guest WiFi page: share the WiFi with visitors using a QR code they can "
                                    + "scan — no typing the password."),
                            change("new", "Alerts: get notified about unusual usage, like a spike in electricity or "
                                    + "a high-cost day."),
                            change("new", "Household sign-in: everyone gets their own account with a name, photo, and "
                                    + "light or dark theme. Guests can be given limited access."),
                            change("new", "This “What’s New” tab: a plain-language rundown of what "
                                    + "changed each time the app is updated."))));

    @Override
    public void run(String... args) {
        int total = HISTORY.size();
        int inserted = 0;
        int updated = 0;
        for (int i = 0; i < total; i++) {
            AppRelease desired = HISTORY.get(i);
            desired.setSortOrder(total - i); // newest (index 0) gets the highest order

            AppRelease existing = repository.findByVersion(desired.getVersion()).orElse(null);
            if (existing == null) {
                repository.save(desired);
                inserted++;
            } else if (differs(existing, desired)) {
                existing.setStage(desired.getStage());
                existing.setReleasedAt(desired.getReleasedAt());
                existing.setTitle(desired.getTitle());
                existing.setSummary(desired.getSummary());
                existing.setChanges(desired.getChanges());
                existing.setSortOrder(desired.getSortOrder());
                repository.save(existing);
                updated++;
            }
        }
        if (inserted > 0 || updated > 0) {
            log.info("ReleaseSeeder: {} version(s) known — {} inserted, {} updated", total, inserted, updated);
        }
    }

    /** True when any displayed field drifted from the committed definition. */
    private static boolean differs(AppRelease a, AppRelease b) {
        return !a.getStage().equals(b.getStage())
                || !a.getReleasedAt().equals(b.getReleasedAt())
                || !a.getTitle().equals(b.getTitle())
                || !java.util.Objects.equals(a.getSummary(), b.getSummary())
                || a.getSortOrder() != b.getSortOrder()
                || !java.util.Objects.equals(a.getChanges(), b.getChanges());
    }

    private static AppRelease define(String version, String stage, LocalDate releasedAt,
                                     String title, String summary, List<ReleaseChange> changes) {
        return AppRelease.builder()
                .version(version)
                .stage(stage)
                .releasedAt(releasedAt)
                .title(title)
                .summary(summary)
                .changes(changes)
                .build();
    }

    private static ReleaseChange change(String type, String text) {
        return ReleaseChange.builder().type(type).text(text).build();
    }
}
