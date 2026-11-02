import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import { schoolClock, toHHMM } from '../common/school-time.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { SchedulerService } from '../jobs/scheduler.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LATE_START_GRACE_MINUTES } from './timetable.service.js';

/** Minutes before a period the teacher is reminded. */
const HEADS_UP_MINUTES = 5;
type Kind = 'soon' | 'late' | 'missed';

/**
 * Every minute, per school (in its own time zone): reminds each teacher 5 minutes before a period,
 * tells them when a period is running without being started ("late, please start"), and when it
 * ended without being held ("missed"). Each message is sent once per period per day.
 */
@Injectable()
export class ClassRemindersService implements OnModuleInit {
  private readonly log = new Logger(ClassRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    this.scheduler.register({ id: 'timetable.class-reminders', cron: '* * * * *', description: 'Tells teachers 5 minutes before a period, when they are late to start it, and when they missed it', run: () => this.run() });
  }

  async run() {
    const schools = await this.prisma.school.findMany({ where: { status: 'active' }, select: { id: true } });
    let sent = 0;
    for (const { id } of schools) {
      try {
        sent += await this.forSchool(id);
      } catch (e) {
        this.log.warn(`class reminders for ${id} failed: ${(e as Error).message}`);
      }
    }
    return { sent };
  }

  private async forSchool(schoolId: string): Promise<number> {
    const db = this.prisma.forSchool(schoolId);
    const [settings, year] = await Promise.all([
      db.schoolSettings.findUnique({ where: { schoolId }, select: { timezone: true } }),
      db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }),
    ]);
    if (!year) return 0;
    const clock = schoolClock(settings?.timezone ?? 'UTC');
    const now = clock.minute;
    const slots = await db.timetableSlot.findMany({
      where: { academicYearId: year.id, dayOfWeek: clock.dayOfWeek, startMinute: { lte: now + HEADS_UP_MINUTES }, endMinute: { gte: now - 30 } },
      select: {
        id: true,
        startMinute: true,
        endMinute: true,
        subject: { select: { name: true } },
        room: { select: { name: true } },
        section: { select: { name: true, schoolClass: { select: { name: true } } } },
        employee: { select: { userId: true } },
        sessions: { where: { sessionDate: toDateOnly(clock.date) }, select: { id: true } },
      },
    });
    let sent = 0;
    for (const s of slots) {
      const userId = s.employee.userId;
      if (!userId || s.sessions.length) continue;
      const what = `${s.subject.name} · ${s.section.schoolClass.name} ${s.section.name}${s.room ? ` · ${s.room.name}` : ''}`;
      const at = `${toHHMM(s.startMinute)}–${toHHMM(s.endMinute)}`;
      let kind: Kind | null = null;
      if (now >= s.endMinute) kind = 'missed';
      else if (now >= s.startMinute + LATE_START_GRACE_MINUTES) kind = 'late';
      else if (now >= s.startMinute - HEADS_UP_MINUTES && now < s.startMinute) kind = 'soon';
      if (!kind) continue;
      // Once per period, day and kind, even with several API replicas.
      const first = await this.redis.set(`schoolerp:class-reminder:${s.id}:${clock.date}:${kind}`, '1', 'EX', 2 * 86_400, 'NX');
      if (first !== 'OK') continue;
      const message = {
        soon: { title: `Your class starts in ${s.startMinute - now} min`, body: `${what} at ${toHHMM(s.startMinute)}. Start it from Today's Classes.` },
        late: { title: 'You are late: please start your class', body: `${what} began at ${toHHMM(s.startMinute)} and has not been started yet.` },
        missed: { title: 'You missed a class', body: `${what} (${at}) ended without being started.` },
      }[kind];
      await this.notifications.notify(schoolId, [userId], { eventType: `class_${kind}`, ...message, link: '/todays-classes' });
      sent++;
    }
    return sent;
  }
}
