import "server-only";
import { prisma } from "../prisma";

// Called after alliance and OCR access have been checked.
export async function captureDestinations(allianceId: string, current?: { id:string; name:string }) {
  const [metrics, periods] = await Promise.all([
    prisma.metric.findMany({where:{allianceId,active:true,type:"NUMERIC"},orderBy:{name:"asc"},select:{id:true,name:true,observationGrain:true}}),
    prisma.metricPeriod.findMany({where:{allianceId,active:true},orderBy:[{startsAt:"desc"},{name:"asc"}],select:{id:true,name:true}}),
  ]);
  return {periodId:current?.id ?? "auto",name:current?.name ?? "the scoring week", periods,
    metrics:metrics.map(m=>({id:m.id,name:m.name,daily:m.observationGrain==="DAILY_OBSERVATION"}))};
}
