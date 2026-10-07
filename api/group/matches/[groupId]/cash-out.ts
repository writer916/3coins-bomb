import { GroupCashOutError, cashOutGroupRound, validateGroupCashOutRequest } from '../../../../server/group/cashOutRound.js'
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }
function groupId(request: Request) { const match=/^\/api\/group\/matches\/([^/]+)\/cash-out\/?$/.exec(new URL(request.url).pathname); try { return match ? decodeURIComponent(match[1]!) : null } catch { return null } }
async function hasPayload(request: Request): Promise<boolean> {
  if (!request.body) return false
  const reader=request.body.getReader(); let bytes=0
  while(true){const {done,value}=await reader.read();if(done)return false;bytes+=value.byteLength;if(bytes>0){await reader.cancel();return true}}
}
export function createGroupCashOutHandler(cashOut = cashOutGroupRound) { return async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return Response.json({error:{code:'invalid_request'}},{status:405,headers:{...headers,Allow:'POST'}})
  if (await hasPayload(request)) return Response.json({error:{code:'invalid_request'}},{status:400,headers})
  try { return Response.json(await cashOut(validateGroupCashOutRequest(groupId(request),request.headers.get('authorization'),request.headers.get('idempotency-key'))),{status:200,headers}) }
  catch(error) { if(error instanceof GroupCashOutError) return Response.json({error:{code:error.code==='CONFLICT'?'cash_out_conflict':'play_unavailable'}},{status:error.code==='CONFLICT'?409:404,headers}); return Response.json({error:{code:'internal_error'}},{status:500,headers}) }
} }
export default { fetch: createGroupCashOutHandler() }
