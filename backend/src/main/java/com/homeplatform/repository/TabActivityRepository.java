package com.homeplatform.repository;

import com.homeplatform.model.TabActivity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface TabActivityRepository extends JpaRepository<TabActivity, Long> {

    /** Per member, tab and kind since {@code since}: how many, and the latest. */
    interface Tally {
        Long getUserId();
        String getTab();
        TabActivity.Kind getKind();
        long getCount();
        LocalDateTime getLast();
    }

    @Query("select a.userId as userId, a.tab as tab, a.kind as kind, count(a) as count, max(a.at) as last "
            + "from TabActivity a where a.at >= :since group by a.userId, a.tab, a.kind")
    List<Tally> tally(@Param("since") LocalDateTime since);
}
