package com.homeplatform.dto;

import java.time.Instant;
import java.util.List;

/**
 * Who's home, from the devices seen on the home Wi-Fi. A device is home while it was
 * seen within {@code awayAfterMinutes}; a member is home while any of their phones or
 * watches is. {@code home} is null for everyone while the scanner isn't reporting,
 * since nothing current is known. {@code members} fills the owner dropdown.
 */
public record PresenceResponse(Scanner scanner, int awayAfterMinutes, List<Person> people, List<Device> devices,
                               List<Member> members) {

    /** {@code online}: a scan landed in the last few minutes. */
    public record Scanner(Instant lastScanAt, boolean online, int devicesInLastScan) {}

    /**
     * A member with a device. {@code since}: home since (earliest current stretch);
     * {@code lastSeen}: latest sighting of a device that counts; {@code devices}: all of theirs.
     */
    public record Person(Long userId, String name, Boolean home, Instant since, Instant lastSeen, int devices) {}

    /**
     * {@code type}: MOBILE, COMPUTER, TABLET, WATCH, TV, SMART_HOME or OTHER (null until set).
     * {@code privateAddress}: a phone-style randomized MAC (the second hex digit is 2, 6, A or E).
     */
    public record Device(Long id, String mac, String ip, String name, String type, Long ownerUserId, String owner,
                         boolean privateAddress, Boolean home, Instant firstSeen, Instant lastSeen, Instant presentSince) {}

    public record Member(Long id, String name) {}
}
