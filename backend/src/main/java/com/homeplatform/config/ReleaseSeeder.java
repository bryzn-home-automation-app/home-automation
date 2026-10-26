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

    /** Newest release first. Keep every summary and change to one short line. */
    private static final List<AppRelease> HISTORY = List.of(
            define("1.5.0", "stable", LocalDate.of(2026, 10, 20),
                    "Thermostats, cameras and a faster app",
                    "Run the ecobees and watch the Eufy cameras from the app, and everything loads faster.",
                    List.of(
                            change("new", "Climate tab: see and set both ecobee thermostats, with history and who changed them last."),
                            change("new", "A heads-up before you override someone's thermostat change from the last 10 minutes."),
                            change("new", "Cameras tab: latest snapshots, plus live video that runs while you're watching (pauses after 5 idle minutes)."),
                            change("new", "Battery and solar-charging history for the outdoor cameras."),
                            change("new", "Recordings: play back the cameras' full-quality 3K clips from the HomeBase (Cameras → Recordings)."),
                            change("new", "Send cameras to their saved positions, and pan or tilt them during live view."),
                            change("new", "Camera alerts for low battery, no solar charging, offline cameras and people outside."),
                            change("new", "Auto theme: light by day, dark after sunset at home (Profile → Theme → Auto)."),
                            change("new", "Phone alerts for camera and critical alerts from the Home Screen app (Profile → Phone alerts)."),
                            change("new", "Alert types: choose which alerts you get, and which reach your phone (Profile → Alert types)."),
                            change("improved", "Pages load about twice as fast, especially on phones."),
                            change("improved", "Colors that were hard to read in light or dark mode are fixed."),
                            change("improved", "Bills now open only for signed-in members, and disabled accounts lose access right away."),
                            change("improved", "Every camera goes live as soon as you open the Cameras tab, the outdoor ones too (no tap needed)."),
                            change("improved", "The cameras warm up while you're using any part of the app, so the Cameras tab opens already live."),
                            change("new", "Usage (Admin): see which tabs house members use the most, updated every minute."),
                            change("new", "Who's Home (Admin): see who's home from the phones on the home Wi-Fi. Name each device, pick its type and its owner."),
                            change("new", "Profile → This device: link the phone you're holding to your account in two taps, so Who's Home knows it's yours."),
                            change("new", "Sleep screen: left open and untouched for 10 minutes, the app sleeps and the cameras pause (a minute's warning first; tap to wake)."),
                            change("improved", "Phone menu bar: AC/Heat Ecobee (the thermostats) and Cameras are one tap away; Alerts moved into Menu, which shows the unread count."),
                            change("improved", "The electric forecast misses by about a third less: it learns from the weather that actually happened, and from weekends."),
                            change("fixed", "A day's electric total that first arrives as zero now corrects itself."),
                            change("fixed", "Recordings no longer stop loading after the HomeBase connection goes quiet."),
                            change("fixed", "Signing in on iPhone with a saved password works again."),
                            change("fixed", "Your color palette stays put in light and dark mode, and after signing back in."),
                            change("fixed", "On the Default palette, Predicted and Actual on the forecast chart are no longer both green."),
                            change("fixed", "Phone alerts reach iPhones (Apple was turning them away)."))
            ),
            define("1.4.0", "stable", LocalDate.of(2026, 9, 28),
                    "Bills, a clearer forecast and robot upkeep",
                    "Bills open in the app, the forecast is easier to read, and the Roomba tracks its parts.",
                    List.of(
                            change("new", "Electric, gas and water bills open right in the app."),
                            change("new", "The Electric tab is split into Usage & Bills and Forecast & Stats."),
                            change("new", "The last 30 days next to the next 14 predicted, plus predicted vs. actual on Last Reading."),
                            change("new", "Day-by-day forecast accuracy."),
                            change("new", "Roomba Maintenance: how much life is left on the filter, brushes, mop pad and dock bag."),
                            change("new", "A pixel-art scene on every tab."),
                            change("improved", "The forecast learns from yesterday's miss and is honest about far-out days."),
                            change("improved", "Alerts moved to a bell icon, and long lists scroll smoothly."),
                            change("improved", "The WiFi page is a single QR code."),
                            change("fixed", "Gas charts no longer come up blank or show highs and lows of 0."),
                            change("fixed", "Sign-in ignores capital letters in your username."))
            ),
            define("1.3.0", "stable", LocalDate.of(2026, 9, 12),
                    "A faster, clearer forecast",
                    "The forecast updates within minutes and its range is easier to see.",
                    List.of(
                            change("improved", "The forecast updates within minutes of a new reading."),
                            change("improved", "One unusual day no longer throws off the trend."),
                            change("improved", "The shaded range adapts faster to how accurate recent predictions were."),
                            change("fixed", "The shaded range is easier to see and no longer vanishes for yesterday."),
                            change("improved", "Section titles are larger and easier to read."),
                            change("fixed", "Water bill amounts show a full-size $ sign."))
            ),
            define("1.2.0", "stable", LocalDate.of(2026, 9, 6),
                    "Smarter forecasts, real schedules",
                    "The forecast got smarter, and Roomba schedules now save to the robot itself.",
                    List.of(
                            change("new", "See which weekdays you use more or less power than the weather predicts."),
                            change("improved", "The 7- and 14-day forecast views show all their days."),
                            change("improved", "Yesterday's usage shows up a day sooner."),
                            change("improved", "A narrower, easier-to-read forecast range."),
                            change("new", "Roomba schedules save to the robot and appear in the iRobot app."),
                            change("fixed", "More reliable Roomba commands."),
                            change("fixed", "Corrected daily trends, rolling averages and partial-day totals."))
            ),
            define("1.1.2", "stable", LocalDate.of(2026, 8, 25),
                    "Clean your way",
                    "Start a clean for the whole house or just the rooms you pick.",
                    List.of(
                            change("new", "Clean: choose rooms, suction, passes and vacuum, mop or both."),
                            change("improved", "The robot still docks itself when it's done."))
            ),
            define("1.1.1", "stable", LocalDate.of(2026, 8, 24),
                    "Smoother pop-ups",
                    "Pop-up windows feel snappy again.",
                    List.of(
                            change("fixed", "Editing your profile no longer lags."),
                            change("fixed", "Other pop-ups respond more smoothly too."))
            ),
            define("1.1.0", "stable", LocalDate.of(2026, 8, 24),
                    "Faster and smoother",
                    "The app feels quicker, the live vacuum map is smooth, and Home greets you by name.",
                    List.of(
                            change("improved", "Screens and charts respond faster."),
                            change("improved", "Home greets you by name and loads lighter."),
                            change("improved", "The live vacuum map stays smooth while it cleans."),
                            change("improved", "Theme and accent color changes are instant."),
                            change("improved", "Smoother scrolling on phones and in long lists."),
                            change("fixed", "Usage charts no longer fail to appear when a page opens."))
            ),
            define("1.0.0", "beta", LocalDate.of(2026, 8, 22),
                    "Welcome to HomeOS",
                    "One place to see the house, track utilities and run the robot vacuum.",
                    List.of(
                            change("new", "Electricity tracking, compared against the weather."),
                            change("new", "A running estimate of this month's electric bill."),
                            change("new", "Gas and water tabs."),
                            change("new", "The robot vacuum's live map, cleaning history and room cleaning."),
                            change("new", "A guest WiFi QR code."),
                            change("new", "Alerts for unusual usage."),
                            change("new", "Personal accounts with a photo and theme, plus limited guest access."),
                            change("new", "This What's New tab."))
            ));

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
