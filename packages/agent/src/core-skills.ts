/**
 * Core skills - the minimal engine skill set.
 * Users add more via the skills directory (~/.caprigo/skills or ./skills).
 */

import { Skill } from '@caprigo/shared';
import { fileSystemSkills } from './skills/filesystem';
import { shellSkills } from './skills/shell';
import { httpSkills } from './skills/http';
import { memorySkills } from './skills/memory';
import { systemSkills } from './skills/system';
import { vibesSkills } from './skills/vibes';
import { webSkills } from './skills/web';

export const coreSkills: Skill[] = [
  ...fileSystemSkills,
  ...shellSkills,
  ...httpSkills,
  ...webSkills,
  ...memorySkills,
  ...systemSkills,
  ...vibesSkills,
];
