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
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Seeds the {@code app_releases} table from the code-authored history below.
 * Release notes are hand-written in plain language for the whole household; this
 * class is the source of truth. On each startup it upserts every entry by version
 * (insert if new, refresh the fields if the wording changed), so the DB always
 * mirrors what's committed here, and removes any version no longer listed.
 *
 * <p>Notes go out once a week, on Friday morning: one entry for everything that
 * shipped since the last one, not an entry per deploy. During the week, add each
 * change to {@code RELEASE_NOTES_PENDING.md} at the repo root; on Friday, prepend
 * a single {@link #define} entry to {@link #HISTORY} (newest first) from that file
 * and empty it. Display order is assigned automatically from list position, so it
 * never depends on string-comparing semantic versions.
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
            define("2.9.1", "stable", LocalDate.of(2026, 11, 13),
                    "A new look, a smarter Roomba page and reminders",
                    "This week: a new design, Roomba tools for when a clean goes wrong, reminders, password reset, Gas by the bill and Server health.",
                    List.of(
                            change("new", "A new look across the app, in light and dark. Each page opens with the answer to what you came for."),
                            change("new", "Alerts are always one tap away, at the top of every page."),
                            change("new", "Profile, Appearance has a colour wheel. Pick any colour or type its code, and the whole app takes it on."),
                            change("new", "Reminders: set up chores like trash day, choose when to get a heads-up, and mark them done for the week. They show on Home and can alert your phone."),
                            change("new", "Home shows the week's weather by default, with a switch to the next 24 hours."),
                            change("new", "Forgot password? on the sign-in page lets a house member set a new Home password after confirming their birthday. It works only at the app's secure address."),
                            change("new", "People: Bryan can set each member's birthday and clear wrong tries. He is told about every reset and every wrong birthday."),
                            change("new", "Roomba: when the robot is stopped away from its dock, the map marks where it was last seen and the status says which room and when."),
                            change("new", "Roomba: the page says when the dock's clean-water tank is empty or its dirty-water tank is full, instead of Ready, and an alert is sent."),
                            change("new", "Roomba: an alert when a scheduled clean didn't start, with the dock's reason when there is one."),
                            change("new", "Roomba: Bryan can skip today's or tomorrow's scheduled clean, and undo it. The schedule is switched off in the iRobot app around that clean and back on afterwards."),
                            change("new", "Roomba: Time per clean charts the last 14 cleans, split into cleaning, recharging and paused time, with the typical clean and how often it had to recharge."),
                            change("new", "Roomba map: ground cleaned this run shows in teal, and ground cleaned twice with a cross-ruled pattern."),
                            change("new", "Gas: charts of gas used and gas charges for every bill, with the outside temperature for each billing cycle."),
                            change("new", "Gas: the last bill is broken down line by line, with what a CCF of gas really costs and what you pay with none."),
                            change("new", "Server health shows the NUC's processor, memory, drive, temperatures and Wi-Fi now, and over the last day, week or month."),
                            change("new", "Server health lists each app container, grouped by project, with the memory it uses, and the programs working the NUC hardest."),
                            change("new", "Server health spells out problems: a drive filling up, Docker not responding, running hot, set to sleep, or Windows waiting to restart."),
                            change("new", "Admins are told when the NUC restarts, and whether it crashed or lost power, and when a problem lasts."),
                            change("improved", "Pages are named in plain words: Utilities, Climate, People, Alerts, Server health."),
                            change("improved", "The four colour palettes are now four finishes for the background. The theme can also follow your phone."),
                            change("improved", "On a computer, pages use the full width of the window."),
                            change("improved", "When something fails to load, the page says so and offers Try again instead of looking empty."),
                            change("improved", "Climate: Downstairs and Upstairs each have their own panel, side by side, with no tabs. Their history is on one chart."),
                            change("improved", "Cameras: every battery camera is on one chart, with a scale that fits the readings and a switch back to 0–100%."),
                            change("improved", "Gas shows your last bill, the gas it used, its flat charges and when the next bill should arrive."),
                            change("improved", "Roomba map: rooms are shaded so they stand apart, names always fit, and off-limits and no-mop areas each have their own pattern."),
                            change("improved", "Roomba commands are sent the moment you press them, and show as done once the robot actually reacts."),
                            change("improved", "Roomba: the robot's position is followed on its way back to the dock, so a robot that never makes it home is marked where it gave up."),
                            change("improved", "Roomba: cleaning time no longer counts minutes spent paused."),
                            change("improved", "Roomba: the robot's schedules are read again every few hours, so Next clean follows changes made in the iRobot app."),
                            change("improved", "People: someone who is away shows when they were last active, and the list refreshes every minute."),
                            change("fixed", "People: house members and Bryan show as online while they have the app open. Before, only guests could, and a guest stayed online for up to 30 days."),
                            change("fixed", "Roomba: a robot stopped away from its dock is no longer described as docked and ready."),
                            change("fixed", "Roomba: Pause is offered for the whole clean, and pausing or docking no longer interrupts the live position on the map."),
                            change("fixed", "On an iPhone, the bottom bar stays at the bottom of the screen on every tab."),
                            change("fixed", "On an iPhone, live view no longer sticks on \"Waking camera…\". If the phone holds the video back, one tap on Play starts every camera."),
                            change("fixed", "The Living Room camera no longer takes half a minute to start when someone's in the room."),
                            change("fixed", "Gas costs used a made-up price per unit and missed the flat charges, which are about half the bill."),
                            change("fixed", "Water bills come in again: the Gmail sign-in no longer runs out every week."),
                            change("fixed", "A brief server hiccup no longer signs you out."),
                            change("fixed", "The guest Wi-Fi code now scans in the dark theme."),
                            change("fixed", "Dates, money and numbers read the same way on every page, and something from an hour ago reads \"1 hr ago\" just after midnight."),
                            change("fixed", "Profile: the switches on the Weather alerts card stay inside the card."))),
            define("1.8.1", "stable", LocalDate.of(2026, 11, 6),
                    "Weather alerts, accurate Roomba history and phone fixes",
                    "This week: weather alerts you choose, Roomba history that matches the iRobot app, full-screen cameras, and a round of phone and security fixes.",
                    List.of(
                            change("new", "The admin Logs page lists every thermostat change someone made: at the thermostat, in the ecobee app, or in this app."),
                            change("new", "Weather alerts under Profile: rain, thunderstorms, freeze, extreme heat, high wind, and snow or ice."),
                            change("new", "Each is checked at a time you pick, for the hours you pick. Rain at 8 PM through 8 AM tells you whether to pause the sprinklers."),
                            change("new", "Set what counts: the chance of rain, how cold, how hot, or how windy."),
                            change("new", "Official National Weather Service warnings for home (tornado, severe storm, flood and more) as soon as they're issued."),
                            change("new", "\"Check the forecast now\" shows what an alert would say right now."),
                            change("new", "Roomba runs show the rooms cleaned, the settings, recharge stops and how often the bin was emptied."),
                            change("new", "Tap ⤢ on a live camera to watch it full screen."),
                            change("new", "An alert when a Roomba clean doesn't finish (stuck), with what stopped it."),
                            change("improved", "A thermostat card says \"Set by schedule\" when ecobee's schedule changed it, instead of \"Set at ecobee\"."),
                            change("improved", "Roomba history comes from iRobot's own records: real cleaning time and area, and runs that happened while the server was off."),
                            change("improved", "The Roomba tab says when it's docked mid-clean to recharge instead of calling the run finished."),
                            change("improved", "The Roomba's live position no longer drops out every hour during a clean."),
                            change("improved", "The daily usage report waits until CoServ has posted the whole day."),
                            change("improved", "The monthly estimate covers all of last month, not the first day or two of this one."),
                            change("improved", "Admins get an alert when the water-bill Gmail sign-in expires."),
                            change("improved", "After an update the app reloads itself instead of showing a blank page; a broken page no longer takes down the whole app."),
                            change("fixed", "On a phone, a recording now has a close button you can reach, and the back gesture closes it instead of leaving Cameras. The same goes for a bill."),
                            change("fixed", "Edit Profile and a Roomba run's details fit on a phone screen, so Save and Close can be reached."),
                            change("fixed", "Swiping on a pop-up no longer scrolls the page behind it."),
                            change("fixed", "Notifications no longer overlap each other on a phone."),
                            change("fixed", "Pages start below the status bar in the Home Screen app."),
                            change("fixed", "A change made in this app was recorded twice."),
                            change("fixed", "The phone menu scrolls on its own instead of scrolling the page behind it."),
                            change("fixed", "Pages that need sign-in can no longer be reached without it."),
                            change("fixed", "Maintenance dates no longer show one day early, and editing a record no longer duplicates its photos."),
                            change("fixed", "A thermostat change made just before leaving the page is still sent."),
                            change("fixed", "\"Last updated\" times show correctly on iPhone and on the Debug page."),
                            change("fixed", "Signing out clears what the last person was looking at."))),
            define("1.6.0", "stable", LocalDate.of(2026, 10, 26),
                    "Who's Home, phone alerts and recordings",
                    "See who's home, get alerts on your phone, play back camera clips, and pull down to refresh.",
                    List.of(
                            change("new", "Phone alerts for camera and critical alerts from the Home Screen app (Profile → Phone alerts)."),
                            change("new", "Alert types: choose which alerts you get, and which reach your phone (Profile → Alert types)."),
                            change("new", "Recordings: play back the cameras' full-quality 3K clips from the HomeBase (Cameras → Recordings)."),
                            change("new", "Send cameras to their saved positions, and pan or tilt them during live view."),
                            change("new", "Profile → This device: link the phone you're holding to your account in two taps, so the app knows when you're home."),
                            change("new", "Indoor camera alerts while everyone's away: someone seen inside, or a few minutes of noise (the noise alert needs the camera's Sound detection on)."),
                            change("new", "On your phone, pull down at the top of any page to refresh it."),
                            change("new", "Auto theme: light by day, dark after sunset at home (Profile → Theme → Auto)."),
                            change("new", "Sleep screen: left open and untouched for 10 minutes, the app sleeps and the cameras pause (a minute's warning first; tap to wake)."),
                            change("new", "Who's Home (Admin): see who's home from the phones on the home Wi-Fi. Name each device, pick its type and its owner."),
                            change("new", "Usage (Admin): see which tabs house members use the most, updated every minute."),
                            change("improved", "The Cameras tab opens already live, outdoor cameras too: they warm up while you use the app."),
                            change("improved", "Live video pauses after 5 idle minutes."),
                            change("improved", "Phone menu bar: AC/Heat Ecobee (the thermostats) and Cameras are one tap away; Alerts moved into Menu, which shows the unread count."),
                            change("improved", "The electric forecast misses by about a third less: it learns from the weather that actually happened, and from weekends."),
                            change("improved", "Colors that were hard to read in light or dark mode are fixed."),
                            change("fixed", "Signing in on iPhone with a saved password works again."),
                            change("fixed", "Your color palette stays put in light and dark mode, and after signing back in."),
                            change("fixed", "On the Default palette, Predicted and Actual on the forecast chart are no longer both green."))
            ),
            define("1.5.0", "stable", LocalDate.of(2026, 10, 20),
                    "Thermostats, cameras and a faster app",
                    "Run the ecobees and watch the Eufy cameras from the app, and everything loads faster.",
                    List.of(
                            change("new", "Climate tab: see and set both ecobee thermostats, with history and who changed them last."),
                            change("new", "A heads-up before you override someone's thermostat change from the last 10 minutes."),
                            change("new", "Cameras tab: latest snapshots, plus live video that only runs while you're watching."),
                            change("new", "Battery and solar-charging history for the outdoor cameras."),
                            change("new", "Camera alerts for low battery, no solar charging, offline cameras and people outside."),
                            change("improved", "Pages load about twice as fast, especially on phones."),
                            change("improved", "Bills now open only for signed-in members, and disabled accounts lose access right away."),
                            change("fixed", "A day's electric total that first arrives as zero now corrects itself."))
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
                    "Clean your way, faster and smoother",
                    "This week: start a clean for the whole house or just the rooms you pick, and the app feels quicker throughout.",
                    List.of(
                            change("new", "Clean: choose rooms, suction, passes and vacuum, mop or both."),
                            change("improved", "The robot still docks itself when it's done."),
                            change("improved", "Screens and charts respond faster."),
                            change("improved", "Home greets you by name and loads lighter."),
                            change("improved", "The live vacuum map stays smooth while it cleans."),
                            change("improved", "Theme and accent color changes are instant."),
                            change("improved", "Smoother scrolling on phones and in long lists."),
                            change("fixed", "Editing your profile no longer lags."),
                            change("fixed", "Other pop-ups respond more smoothly too."),
                            change("fixed", "Usage charts no longer fail to appear when a page opens."))),
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
        // A version folded into its week's entry is no longer in HISTORY: drop its row.
        Set<String> known = HISTORY.stream().map(AppRelease::getVersion).collect(Collectors.toSet());
        List<AppRelease> retired = repository.findAll().stream()
                .filter(r -> !known.contains(r.getVersion()))
                .toList();
        repository.deleteAll(retired);
        if (inserted > 0 || updated > 0 || !retired.isEmpty()) {
            log.info("ReleaseSeeder: {} version(s) known — {} inserted, {} updated, {} retired",
                    total, inserted, updated, retired.size());
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
