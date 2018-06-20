import { Entity, EntityWithPartialId } from './entity';
import { Quality } from './entry';

export type Agent = {
  userAgent: string,
  language: string,
  resolution: {
    width: number,
    height: number
  },
  referrer: string,
  timestamp: number
}

export type Timing = {
  source: string,
  data: StringMap
}

export enum UserActionType {
  Visit = 'visit',
  Download = 'download',
  Play = 'play',
  Pause = 'pause',
  Comment = 'comment',
  Rating = 'rating'
}

export type UserActionFilter = Partial<Visit | Download | Play | Pause | Comment | Rating>;

export type UserAction = Entity & {
  actionType: UserActionType,
  userID: string,
  timestamp: number,
  visitId: string,
  pageViewId: string
}

type EntryAction = UserAction & {
  entryID: string
}

type PlayPause = EntryAction & {
  seconds: number
}

export type Visit = UserAction & {
  actionType: UserActionType.Visit,
  route: string,
  agent: Agent,
  timings: Timing[]
}

export type Download = EntryAction & {
  actionType: UserActionType.Download,
  quality: Quality
}

export type Play = PlayPause & {
  actionType: UserActionType.Play,
  quality: Quality
}

export type Pause = PlayPause & {
  actionType: UserActionType.Pause,
}

export type Comment = EntryAction & {
  actionType: UserActionType.Comment,
  text: string
}

export type Rating = EntryAction & {
  actionType: UserActionType.Rating,
  value: number
}

export type UserActionWithPartialId = EntityWithPartialId<UserAction>;

export type VisitWithPartialId = EntityWithPartialId<Visit>;

export type DownloadWithPartialId = EntityWithPartialId<Download>;

export type PlayWithPartialId = EntityWithPartialId<Play>;

export type PauseWithPartialId = EntityWithPartialId<Pause>;

export type CommentWithPartialId = EntityWithPartialId<Comment>;

export type RatingWithPartialId = EntityWithPartialId<Rating>;