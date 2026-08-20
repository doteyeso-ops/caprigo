/**
 * Core skills - the minimal engine skill set.
 * Users add more via the skills directory (~/.caprigo/skills or ./skills).
 *
 * harnessCoreSkills: lean CLI kit (no Vibes marketplace tools).
 * coreSkills: full set including Vibes (gateway / legacy UI).
 */

import { Skill } from '@caprigo/shared';
import { fileSystemSkills } from './skills/filesystem';
import { shellSkills } from './skills/shell';
import { httpSkills } from './skills/http';
import { memorySkills } from './skills/memory';
import { systemSkills } from './skills/system';
import { vibesSkills } from './skills/vibes';
import { webSkills } from './skills/web';
import { browserSkills, closeBrowserSession } from './skills/browser';
import { imageSkills } from './skills/image';
import { brainSkills } from './skills/brain';
import { desktopSkills } from './skills/desktop';
import { todoSkills } from './skills/todo';

export { closeBrowserSession };

/** Filesystem, shell, http, web, browser, desktop, memory, system, image, brain, todo — default CLI harness kit. */
export const harnessCoreSkills: Skill[] = [
  ...fileSystemSkills,
  ...shellSkills,
  ...httpSkills,
  ...webSkills,
  ...browserSkills,
  ...desktopSkills,
  ...memorySkills,
  ...systemSkills,
  ...imageSkills,
  ...brainSkills,
  ...todoSkills,
];

export const coreSkills: Skill[] = [
  ...harnessCoreSkills,
  ...vibesSkills,
];
