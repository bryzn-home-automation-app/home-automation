import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProfile, updateProfile as apiUpdateProfile, type ProfileUpdateRequest } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import UserProfileCard from '../components/profile/UserProfileCard';
import UserEditModal from '../components/profile/UserEditModal';

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState('');

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    staleTime: 60_000,
    enabled: !!user,
  });

  if (profile.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-48 rounded-[32px] bg-appinset" />
      </div>
    );
  }

  if (!profile.data) {
    return (
      <div className="flex h-64 items-center justify-center text-apptext-muted">
        Unable to load profile.
      </div>
    );
  }

  const p = profile.data;

  const handleSave = async (req: ProfileUpdateRequest) => {
    setSaveError('');
    const updated = await apiUpdateProfile(req);
    // Update the profile cache and the auth user context
    queryClient.setQueryData(['profile'], updated);
    queryClient.invalidateQueries({ queryKey: ['profile'] });
    // Refresh auth context so sidebar avatar + name update instantly everywhere
    refreshUser();
  };

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Page header */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Profile
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Your Identity
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Manage how you appear across the home dashboard. Your role and accent color personalize the experience for everyone.
            </p>
          </div>
        </div>
      </section>

      {/* Profile card */}
      <UserProfileCard
        displayName={p.displayName}
        username={p.username}
        email={p.email}
        phone={p.phone}
        avatarUrl={p.avatarUrl}
        accentColor={p.accentColor}
        role={p.role}
        onEdit={() => setEditing(true)}
      />

      {saveError && (
        <div className="rounded-2xl border border-appdanger/30 bg-appdanger/10 px-4 py-3 text-sm text-appdanger">
          {saveError}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <UserEditModal
          profile={p}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
