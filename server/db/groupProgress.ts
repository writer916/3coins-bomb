import { sql } from 'drizzle-orm'
import { getDatabase } from './client.js'
export interface GroupProgressView { groupId:string; playerLimit:number; acceptedCount:number; completedCount:number; status:'open'|'closed'; selfCompleted:boolean; selfIsHostParticipant:boolean; hostCloseAvailable:boolean }
interface Row extends Record<string,unknown>{group_id:string;player_limit:number;accepted_count:number;completed_count:number;status:'open'|'closed';self_completed:boolean;self_is_host:boolean}
export async function getGroupProgress(groupId:string,participantTokenHash:string):Promise<GroupProgressView|null>{const result=await getDatabase().execute<Row>(sql`
 select match.id group_id,match.player_limit,match.accepted_count,match.status,
 count(other.id) filter(where other.completed_at is not null and other.excluded_at is null)::int completed_count,
 (self.completed_at is not null) self_completed,
 coalesce(match.host_participant_id=self.id,false) self_is_host
 from group_matches match join group_participants self on self.group_id=match.id and self.auth_token_hash=${participantTokenHash}
 left join group_participants other on other.group_id=match.id
 where match.id=${groupId}::uuid and self.excluded_at is null
 group by match.id,self.id,self.completed_at`);const row=result.rows[0];if(!row)return null;const selfCompleted=row.self_completed===true;const selfIsHostParticipant=row.self_is_host===true;return{groupId:row.group_id,playerLimit:row.player_limit,acceptedCount:row.accepted_count,completedCount:row.completed_count,status:row.status,selfCompleted,selfIsHostParticipant,hostCloseAvailable:row.status==='open'&&selfCompleted&&selfIsHostParticipant}}
export async function closeGroupByHost(input:{groupId:string;hostTokenHash:string;requestId:string}):Promise<GroupProgressView|null>{const result=await getDatabase().execute<Row>(sql`
 with candidate as materialized(
  select match.*,host.completed_at host_completed from group_matches match
  join group_participants host on host.id=match.host_participant_id and host.group_id=match.id
  where match.id=${input.groupId}::uuid and match.host_token_hash=${input.hostTokenHash}
  for update of match
 ),closed as(
  update group_matches match set status='closed',closed_at=coalesce(match.closed_at,statement_timestamp()),updated_at=statement_timestamp()
  from candidate where match.id=candidate.id and candidate.host_completed is not null and match.status='open' returning match.id
 ),eligible_retry as materialized(
  select id from candidate where host_completed is not null and status='closed'
 ),excluded as(
  update group_participants participant set excluded_at=statement_timestamp(),version=participant.version+1
  where participant.group_id=${input.groupId}::uuid and participant.completed_at is null and participant.excluded_at is null
   and (exists(select 1 from closed) or exists(select 1 from eligible_retry)) returning participant.id
 )
 select candidate.id group_id,candidate.player_limit,candidate.accepted_count,
 count(participant.id) filter(where participant.completed_at is not null and participant.excluded_at is null)::int completed_count,
 'closed'::text status,true self_completed,true self_is_host
 from candidate join group_participants participant on participant.group_id=candidate.id
 where exists(select 1 from closed) or exists(select 1 from eligible_retry)
 group by candidate.id,candidate.player_limit,candidate.accepted_count`);const row=result.rows[0];return row?{groupId:row.group_id,playerLimit:row.player_limit,acceptedCount:row.accepted_count,completedCount:row.completed_count,status:'closed',selfCompleted:true,selfIsHostParticipant:true,hostCloseAvailable:false}:null}
