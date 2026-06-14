import { ARENA, ATTACKS, DODGE, PLAYER } from '../engine/constants';
import type { GameState, PlayerState } from '../engine/types';

const COLORS = {
  p0: '#4da6ff',
  p1: '#ff5d5d',
  bg: '#15181d',
  ground: '#2a2f37',
  hpBack: '#3a3f47',
  staminaFill: '#f0c419',
  hitbox: 'rgba(255,255,255,0.2)',
  stunned: '#ffffff',
};

/** GameState を Canvas に描画する */
export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  render(state: GameState): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, ARENA.floorY + ARENA.playerSize, canvas.width, 4);

    for (const p of state.players) this.drawAttackRange(p);
    for (const p of state.players) this.drawPlayer(p);
    this.drawHud(state);
    this.drawMessage(state);
  }

  private drawPlayer(p: PlayerState): void {
    const { ctx } = this;
    ctx.globalAlpha = p.dodge && p.dodge.elapsed < DODGE.iframes ? 0.4 : 1;
    ctx.fillStyle = p.stunTicks > 0 ? COLORS.stunned : p.id === 0 ? COLORS.p0 : COLORS.p1;
    ctx.fillRect(p.x, ARENA.floorY, ARENA.playerSize, ARENA.playerSize);
    ctx.globalAlpha = 1;
  }

  private drawAttackRange(p: PlayerState): void {
    if (!p.attack) return;
    const spec = ATTACKS[p.attack.kind];
    const active = p.attack.elapsed >= spec.windup && p.attack.elapsed < spec.windup + spec.active;
    if (!active) return;

    const { ctx } = this;
    const cx = p.x + ARENA.playerSize / 2;
    ctx.fillStyle = COLORS.hitbox;
    ctx.fillRect(cx - spec.range, ARENA.floorY - 10, spec.range * 2, ARENA.playerSize + 20);
  }

  private drawHud(state: GameState): void {
    const { ctx, canvas } = this;
    const margin = 16;
    const barWidth = canvas.width / 2 - margin * 2;

    state.players.forEach((p, i) => {
      const x = i === 0 ? margin : canvas.width - margin - barWidth;
      const color = i === 0 ? COLORS.p0 : COLORS.p1;

      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(x, margin, barWidth, 18);
      const hpWidth = (Math.max(0, p.hp) / PLAYER.maxHp) * barWidth;
      ctx.fillStyle = color;
      ctx.fillRect(i === 0 ? x : x + barWidth - hpWidth, margin, hpWidth, 18);

      const sy = margin + 22;
      ctx.fillStyle = COLORS.hpBack;
      ctx.fillRect(x, sy, barWidth, 6);
      const stWidth = (p.stamina / PLAYER.maxStamina) * barWidth;
      ctx.fillStyle = COLORS.staminaFill;
      ctx.fillRect(i === 0 ? x : x + barWidth - stWidth, sy, stWidth, 6);

      ctx.fillStyle = '#e6e6e6';
      ctx.font = '12px system-ui';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText(`WINS: ${p.roundsWon}`, i === 0 ? x : x + barWidth, sy + 22);
    });
  }

  private drawMessage(state: GameState): void {
    if (state.phase === 'fighting') return;

    const { ctx, canvas } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px system-ui';

    const text =
      state.phase === 'matchOver'
        ? `PLAYER ${(state.winner ?? 0) + 1} WINS THE MATCH`
        : state.winner === null
          ? 'DRAW ROUND'
          : `PLAYER ${state.winner + 1} WINS THE ROUND`;

    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
}
