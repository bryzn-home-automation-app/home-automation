package com.homeplatform.repository;

import com.homeplatform.model.NetworkDevice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

public interface NetworkDeviceRepository extends JpaRepository<NetworkDevice, Long> {

    List<NetworkDevice> findByMacIn(Collection<String> macs);

    /** Visitors' devices nobody labeled, gone since {@code before}. */
    @Modifying
    @Transactional
    @Query("DELETE FROM NetworkDevice d WHERE d.label IS NULL AND d.person IS NULL AND d.lastSeen < :before")
    int deleteUnlabeledSeenBefore(LocalDateTime before);
}
