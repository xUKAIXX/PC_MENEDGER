import React from 'react';
import {
  Clock,
  Lock,
  Moon,
  Play,
  Power,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { triggerHaptic } from '../plugins/wolLan';
import { ControlAction } from '../types';

interface Props {
  open: boolean;
  isOnline: boolean;
  shutdownTimerEndsAt: number | null;
  onClose: () => void;
  onWakePc: () => void;
  onControl: (action: ControlAction, seconds?: number) => void;
}

export const ControlSheet: React.FC<Props> = ({
  open,
  isOnline,
  shutdownTimerEndsAt,
  onClose,
  onWakePc,
  onControl,
}) => {
  if (!open) return null;

  const fire = (action: ControlAction, seconds?: number) => {
    triggerHaptic(22);
    onControl(action, seconds);
  };

  const remainingMin =
    shutdownTimerEndsAt && shutdownTimerEndsAt > Date.now()
      ? Math.max(1, Math.ceil((shutdownTimerEndsAt - Date.now()) / 60000))
      : null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>ПУЛЬТ ПИТАНИЯ И МЕДИА</h3>
          <button className="sheet-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="sheet-body">
          {!isOnline ? (
            <button
              className="m-btn-primary"
              onClick={() => {
                triggerHaptic(35);
                onWakePc();
                onClose();
              }}
            >
              <Zap size={17} /> ВКЛЮЧИТЬ ПК (WAKE-ON-LAN)
            </button>
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                ЗВУК И ВОСПРОИЗВЕДЕНИЕ НА ПК
              </div>
              <div className="media-pad">
                <button className="pad-btn" onClick={() => fire('vol_mute')}>
                  <VolumeX size={20} color="var(--coral)" />
                  Mute
                </button>
                <button className="pad-btn" onClick={() => fire('vol_down')}>
                  <Volume1 size={20} color="var(--cyan)" />
                  Тише -
                </button>
                <button className="pad-btn" onClick={() => fire('vol_up')}>
                  <Volume2 size={20} color="var(--volt)" />
                  Громче +
                </button>

                <button className="pad-btn" onClick={() => fire('media_prev')}>
                  <SkipBack size={20} />
                  Назад
                </button>
                <button className="pad-btn" onClick={() => fire('media_play_pause')}>
                  <Play size={20} color="var(--volt)" />
                  Play / Pause
                </button>
                <button className="pad-btn" onClick={() => fire('media_next')}>
                  <SkipForward size={20} />
                  Далее
                </button>
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginTop: 4 }}>
                ПИТАНИЕ WINDOWS
              </div>
              <div className="media-pad" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <button className="pad-btn" onClick={() => fire('lock')}>
                  <Lock size={19} color="var(--cyan)" />
                  Заблокировать
                </button>
                <button className="pad-btn" onClick={() => fire('sleep')}>
                  <Moon size={19} color="var(--amber)" />
                  Режим сна
                </button>
                <button className="pad-btn" onClick={() => fire('restart')}>
                  <RotateCcw size={19} color="var(--amber)" />
                  Перезагрузка
                </button>
                <button className="pad-btn danger" onClick={() => fire('shutdown')}>
                  <Power size={19} />
                  Выключить ПК
                </button>
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginTop: 4 }}>
                ТАЙМЕР АВТОВЫКЛЮЧЕНИЯ {remainingMin ? `(активен: ~${remainingMin} мин)` : ''}
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {[15, 30, 60, 120].map((mins) => (
                  <button
                    key={mins}
                    className="m-btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => fire('shutdown_timer', mins * 60)}
                  >
                    <Clock size={13} color="var(--cyan)" /> {mins}м
                  </button>
                ))}
                {remainingMin && (
                  <button
                    className="m-btn-secondary"
                    style={{ borderColor: 'var(--coral)', color: 'var(--coral)' }}
                    onClick={() => fire('cancel_shutdown')}
                  >
                    Отмена
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
