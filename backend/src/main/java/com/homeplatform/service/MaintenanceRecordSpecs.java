package com.homeplatform.service;

import com.homeplatform.model.MaintenanceRecord;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;

import java.util.ArrayList;
import java.util.List;

/** Builds JPA Specifications for filtered maintenance queries. */
public class MaintenanceRecordSpecs {

    public static Specification<MaintenanceRecord> withFilters(
            Long userId, String category, String area, String status, String priority,
            String search, Integer year) {

        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(cb.equal(root.get("userId"), userId));

            if (category != null && !category.isBlank()) {
                predicates.add(cb.equal(cb.lower(root.get("category")), category.toLowerCase()));
            }
            if (area != null && !area.isBlank()) {
                predicates.add(cb.equal(cb.lower(root.get("area")), area.toLowerCase()));
            }
            if (status != null && !status.isBlank()) {
                predicates.add(cb.equal(root.get("status"),
                        MaintenanceRecord.Status.valueOf(status.toUpperCase())));
            }
            if (priority != null && !priority.isBlank()) {
                predicates.add(cb.equal(root.get("priority"),
                        MaintenanceRecord.Priority.valueOf(priority.toUpperCase())));
            }
            if (year != null && year > 0) {
                predicates.add(cb.equal(cb.function("year", Integer.class, root.get("completedDate")), year));
            }
            if (search != null && !search.isBlank()) {
                String pattern = "%" + search.toLowerCase() + "%";
                predicates.add(cb.or(
                        cb.like(cb.lower(root.get("title")), pattern),
                        cb.like(cb.lower(root.get("description")), pattern),
                        cb.like(cb.lower(root.get("notes")), pattern),
                        cb.like(cb.lower(root.get("contractorName")), pattern),
                        cb.like(cb.lower(root.get("category")), pattern)
                ));
            }

            query.orderBy(cb.desc(root.get("createdAt")));
            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}
