-- Notice board: lock the wording once people have confirmed it.
--
-- When anyone has tapped "I've read and understood this", they confirmed
-- THAT wording. So from then on the title and body can't change; the
-- manager archives it and posts a new one. Pinning, expiry, archiving and
-- the other settings can still change.
--
-- The check looks for any acknowledgement, whatever needs_ack says now, so
-- turning needs_ack off first doesn't open the wording up again.

-- Same as in the notices migration, plus the wording lock.
-- Now security definer: the lock must see EVERY acknowledgement, whoever is
-- editing and whatever the notice_reads policies let them read. The function
-- only checks and stamps this one row, so running with owner rights gives
-- nobody anything extra. (Trigger functions can't be called through the API.)
create or replace function notices_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.archived_at is not null then
    raise exception 'This notice is archived and can''t be changed' using errcode = 'insufficient_privilege';
  end if;
  if new.posted_by is distinct from old.posted_by or new.posted_at is distinct from old.posted_at then
    raise exception 'Who posted a notice, and when, can''t be changed' using errcode = 'insufficient_privilege';
  end if;

  if (new.title, new.body) is distinct from (old.title, old.body)
     and exists (
       select 1 from notice_reads r where r.notice_id = old.id and r.acknowledged_at is not null
     ) then
    raise exception 'People have already confirmed this notice. Archive it and post a new one.'
      using errcode = 'check_violation', hint = 'notice_acknowledged';
  end if;

  -- Archive time comes from the database clock, not the browser.
  if new.archived_at is not null then
    new.archived_at := now();
  end if;

  if (new.title, new.body, new.site_ids, new.pinned, new.needs_ack, new.expires_at)
     is distinct from
     (old.title, old.body, old.site_ids, old.pinned, old.needs_ack, old.expires_at) then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;
