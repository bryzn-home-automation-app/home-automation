package com.homeplatform.repository;

import com.homeplatform.model.MaintenanceRecord;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.List;

@Repository
public interface MaintenanceRecordRepository
        extends JpaRepository<MaintenanceRecord, Long>, JpaSpecificationExecutor<MaintenanceRecord> {

    List<MaintenanceRecord> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    List<MaintenanceRecord> findByUserIdAndStatus(Long userId, MaintenanceRecord.Status status);

    List<MaintenanceRecord> findByUserIdAndCategory(Long userId, String category);

    long countByUserIdAndStatus(Long userId, MaintenanceRecord.Status status);

    @Query("SELECT COALESCE(SUM(m.cost), 0) FROM MaintenanceRecord m WHERE m.userId = :userId AND m.status = 'COMPLETED'")
    BigDecimal sumActualCostCompleted(Long userId);

    @Query("SELECT COALESCE(SUM(m.cost), 0) FROM MaintenanceRecord m WHERE m.userId = :userId AND m.status = 'COMPLETED' AND m.completedDate >= :since")
    BigDecimal sumActualCostCompletedSince(Long userId, java.time.LocalDate since);

    @Query("SELECT COUNT(m) FROM MaintenanceRecord m WHERE m.userId = :userId AND m.status = 'COMPLETED'")
    long countCompleted(Long userId);

    @Query("SELECT m FROM MaintenanceRecord m WHERE m.userId = :userId AND m.completedDate IS NOT NULL ORDER BY m.completedDate DESC")
    List<MaintenanceRecord> findCompletedByUserId(Long userId, Pageable pageable);
}
