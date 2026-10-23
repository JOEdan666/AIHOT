import { SITE, withSubject } from "@aihot/industry/site";
import { data as withHeaders, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { TimelineResponse } from "@aihot/contracts/site";
import { isCategoryKey, isChannelKey, isLaneKey, LANE_CATEGORIES, LANE_LABELS } from "@aihot/contracts/taxonomy";
import { loadOr404, queryString, releaseBoundCache } from "../lib/api.server";
import { listPath, organizationLd, pageMeta } from "../lib/seo";
import { Wordmark } from "../components/Logo";
import { Timeline } from "../features/feed/Timeline";
import { TopicDigests } from "../features/feed/TopicDigests";
import { LaneTabs } from "../features/feed/Filters";
import { beijingDate, beijingWeekday } from "../lib/format";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const channelParam = url.searchParams.get("channel") ?? "all";
  const categoryParam = url.searchParams.get("category");
  const channel = isChannelKey(channelParam) ? channelParam : "all";
  const category = categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const laneParam = url.searchParams.get("lane");
  // A category outside the chosen lane wins: the lane is dropped so the tabs match what is shown.
  const lane = laneParam && isLaneKey(laneParam) && (!category || LANE_CATEGORIES[laneParam].includes(category)) ? laneParam : null;
  const tag = url.searchParams.get("tag")?.trim() || null;
  const upstream = new Headers();
  const data = await loadOr404<TimelineResponse>(`/api/site/timeline${queryString({ channel: channel === "all" ? null : channel, category, lane, tag })}`, { responseHeaders: upstream, signal: request.signal });
  return withHeaders({ data, filters: { channel, category, lane, tag, topic: null } }, { headers: releaseBoundCache(data.refreshAt, 60, Date.now(), upstream) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.filters;
  const path = listPath("/", { channel: f && f.channel !== "all" ? f.channel : null, category: f?.category, lane: f?.lane, tag: f?.tag });
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
  const { data, filters } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : filters.lane ? LANE_LABELS[filters.lane] : "本周";
  return (
    <div className="pb-6">
      {/* Phones: brand bar, this week's topic threads, then the feed. */}
      <div className="flex h-14 items-center justify-between lg:hidden">
        <Wordmark size={20} className="text-ink" />
        <TodayLabel />
      </div>
      <h1 className="hidden text-[28px] font-semibold leading-[1.3] tracking-tight text-ink lg:mb-5 lg:block">{title}</h1>

      {data.topicDigests && <TopicDigests entries={data.topicDigests} />}

      <h2 className="mt-6 text-[20px] font-bold tracking-tight text-ink">{filters.tag || filters.lane ? title : "最新动态"}</h2>
      <LaneTabs base="/" lane={filters.lane} layoutId="home-lane" size="sm" className="mb-2 mt-3" />

      <Timeline initial={data} filters={data.filters} />
    </div>
  );
}
