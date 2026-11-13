package com.homeplatform.repository;

import com.homeplatform.model.RoombaScheduleSkip;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

public interface RoombaScheduleSkipRepository extends JpaRepository<RoombaScheduleSkip, Long> {

    /** One day's skips, plus every skip in the given states whatever its day (AlertEngine's missed-start check). */
    List<RoombaScheduleSkip> findBySkipDateOrStateIn(LocalDate skipDate, Collection<String> states);

    /** Skips still in hand, plus the ones settled lately, newest start first (the page's list). */
    @Query("SELECT s FROM RoombaScheduleSkip s WHERE s.state IN :states OR s.createdAt >= :since "
            + "ORDER BY s.scheduledFor DESC, s.id DESC")
    List<RoombaScheduleSkip> findRecent(@Param("states") Collection<String> states, @Param("since") LocalDateTime since);

    List<RoombaScheduleSkip> findByHouseholdScheduleIdAndStateIn(String householdScheduleId, Collection<String> states);

    List<RoombaScheduleSkip> findByAlertedAtIsNullAndStateIn(Collection<String> states);

    /** Ended skips not alerted on, with this outcome (a schedule left off that the cloud stopped listing). */
    List<RoombaScheduleSkip> findByAlertedAtIsNullAndStateAndDetail(String state, String detail);

    /**
     * Ask the poller to undo a skip. Only these columns: the poller writes the state at any
     * moment, and saving the whole entity could put back a state it had just moved on from.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE RoombaScheduleSkip s SET s.undoRequestedAt = :at, s.undoRequestedBy = :by, s.nextCheckAt = :at, "
            + "s.updatedAt = :at WHERE s.id = :id AND s.undoRequestedAt IS NULL AND s.state IN :states")
    int requestUndo(@Param("id") Long id, @Param("at") LocalDateTime at, @Param("by") String by,
                    @Param("states") Collection<String> states);

    /** Claims the one alert for a skip; 0 when it was already sent. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("UPDATE RoombaScheduleSkip s SET s.alertedAt = :at WHERE s.id = :id AND s.alertedAt IS NULL")
    int markAlerted(@Param("id") Long id, @Param("at") LocalDateTime at);
}
