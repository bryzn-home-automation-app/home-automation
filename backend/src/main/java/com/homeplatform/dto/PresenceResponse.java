package com.homeplatform.dto;

import java.time.Instant;
import java.util.List;

/**
 * Who's home, from the devices seen on the home Wi-Fi. A device is home while it was
 * seen within {@code awayAfterMinutes}; a person is home while any of their devices is.
 * {@code home} is null for everyone while the scanner isn't reporting, since nothing
 * current is known.
 */
public record PresenceResponse(Scanner scanner, int awayAfterMinutes, List<Person> people, List<Device> devices) {

    /** {@code online}: a scan landed in the last few minutes. */
    public record Scanner(Instant lastScanAt, boolean online, int devicesInLastScan) {}

    /** {@code since}: home since (earliest current stretch); {@code lastSeen}: latest sighting of any device. */
    public record Person(String name, Boolean home, Instant since, Instant lastSeen, int devices) {}

    /** {@code privateAddress}: a phone-style randomized MAC (the second hex digit is 2, 6, A or E). */
    public record Device(Long id, String mac, String ip, String label, String person, boolean privateAddress,
                         Boolean home, Instant firstSeen, Instant lastSeen, Instant presentSince) {}
}
