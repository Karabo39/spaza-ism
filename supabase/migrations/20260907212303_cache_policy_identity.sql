-- Identity is constant for a statement; location/role checks stay row-specific.
alter policy report_jobs_read on public.report_email_jobs using (
  user_id = (select auth.uid()) and app.has_store_access(store_id)
);
alter policy notification_preferences_read on public.notification_preferences using (
  user_id = (select auth.uid()) and app.has_store_role(store_id,'manager')
);
alter policy return_access_read on public.store_return_access using (
  app.has_business_role(app.store_business(store_id),'owner') or exists (
    select 1 from public.memberships m
    where m.id = membership_id and m.user_id = (select auth.uid()) and m.is_active
  )
);
