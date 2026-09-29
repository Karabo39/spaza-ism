-- Dispatched/failed deliveries remain operational even when sent before their planned date.
do $$ declare source text; begin
 select pg_get_functiondef('public.delivery_page(uuid,text,date,bigint,uuid)'::regprocedure) into source;
 if position('d.status in (''PENDING'',''OUT_FOR_DELIVERY'',''FAILED'') and d.scheduled_date<=today' in source)=0 then raise exception 'DELIVERY_QUEUE_DEFINITION_CHANGED';end if;
 source:=replace(source,'d.status in (''PENDING'',''OUT_FOR_DELIVERY'',''FAILED'') and d.scheduled_date<=today','(d.status in (''OUT_FOR_DELIVERY'',''FAILED'') or (d.status=''PENDING'' and d.scheduled_date<=today))');
 execute source;
end $$;
