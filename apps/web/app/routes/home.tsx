import { data as withHeaders, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { WeekResponse } from "@aihot/contracts/site";
import { isLaneKey, LANE_LABELS } from "@aihot/contracts/taxonomy";
import { loadOr404, queryString, releaseBoundCache } from "../lib/api.server";
import { listPath, organizationLd, pageMeta } from "../lib/seo";
import { Wordmark } from "../components/Logo";
import { TopicDigests } from "../features/feed/TopicDigests";
import { WeekTop } from "../features/feed/WeekTop";
import { LaneTabs } from "../features/feed/Filters";
import { beijingDate, beijingWeekday } from "../lib/format";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // The home page is the week. Search and the finer filters live on /all; old links land there.
  if (["q", "category", "channel", "tag"].some((k) => url.searchParams.get(k)?.trim())) throw redirect(`/all${url.search}`);
  const laneParam = url.searchParams.get("lane");
  const lane = laneParam && isLaneKey(laneParam) ? laneParam : null;
  const upstream = new Headers();
  const data = await loadOr404<WeekResponse>(`/api/site/week${queryString({ lane })}`, { responseHeaders: upstream, signal: request.signal });
  return withHeaders({ data, lane }, { headers: releaseBoundCache(data.refreshAt, 60, Date.now(), upstream) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/", { lane: loaderData?.lane });
  return pageMeta({ path, jsonLd: path === "/" ? organizationLd() : undefined });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

function TodayLabel() {
  const today = beijingDate(Date.now());
  const [, m, d] = today.split("-").map(Number) as [number, number, number];
  return (
    <span className="text-[12.5px] text-ink-4" suppressHydrationWarning>
      {m}月{d}日 · {beijingWeekday(today).replace("星期", "周")}
    </span>
  );
}

export default function Home() {
  const { data, lane } = useLoaderData<typeof loader>();
  return (
    <div className="pb-6">
      <div className="flex h-14 items-center justify-between lg:hidden">
        <Wordmark size={20} className="text-ink" />
        <TodayLabel />
      </div>
      <h1 className="hidden text-[28px] font-semibold leading-[1.3] tracking-tight text-ink lg:mb-5 lg:block">本周</h1>

      <TopicDigests entries={data.topicDigests} />

      <h2 className="mt-6 text-[20px] font-bold tracking-tight text-ink">{lane ? `本周 · ${LANE_LABELS[lane]}` : "本周最值得看"}</h2>
      <LaneTabs base="/" lane={lane} layoutId="home-lane" size="sm" className="mb-3 mt-3" />
      <WeekTop items={data.items} moreHref="/all" />
    </div>
  );
}
