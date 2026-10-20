package com.homeplatform.push;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface PushVapidKeyRepository extends JpaRepository<PushVapidKey, Integer> {
}
