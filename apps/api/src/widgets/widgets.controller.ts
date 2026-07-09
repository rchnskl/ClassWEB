import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WidgetsService } from './widgets.service';

@ApiTags('widgets')
@ApiBearerAuth()
@Controller('widgets')
export class WidgetsController {
  constructor(private readonly widgets: WidgetsService) {}

  // Authenticated (any signed-in user); no special permission required.
  @Get('environment')
  @ApiOperation({ summary: 'Live weather + air quality (PM2.5 / AQI) for the campus' })
  environment() {
    return this.widgets.environment();
  }
}
