package com.homeplatform.repository;

import com.homeplatform.model.AppEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface AppEventRepository extends JpaRepository<AppEvent, Long> {

    List<AppEvent> findByCategoryOrderByTimestampDesc(String category);

    @Query("SELECT e FROM AppEvent e WHERE e.timestamp >= :since ORDER BY e.timestamp DESC")
    List<AppEvent> findRecent(@Param("since") LocalDateTime since);

    @Query("SELECT e FROM AppEvent e WHERE e.timestamp >= :since AND e.category = :category ORDER BY e.timestamp DESC")
    List<AppEvent> findRecentByCategory(@Param("since") LocalDateTime since, @Param("category") String category);

    @Query("SELECT e FROM AppEvent e WHERE e.timestamp >= :since AND e.level = :level ORDER BY e.timestamp DESC")
    List<AppEvent> findRecentByLevel(@Param("since") LocalDateTime since, @Param("level") String level);

    @Query("SELECT e FROM AppEvent e WHERE e.timestamp >= :since AND e.category = :category AND e.level = :level ORDER BY e.timestamp DESC")
    List<AppEvent> findRecentByCategoryAndLevel(@Param("since") LocalDateTime since,
                                                 @Param("category") String category,
                                                 @Param("level") String level);

    long deleteByTimestampBefore(LocalDateTime cutoff);
}
