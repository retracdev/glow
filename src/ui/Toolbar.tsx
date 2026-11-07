import {
  Bomb,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Maximize,
  Minimize,
  Orbit,
  Pencil,
  SlidersHorizontal,
  Snowflake,
  Tornado,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Tool } from '../settings';

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  className?: string;
  onClick: () => void;
  children?: ReactNode;
}

function IconButton({ icon: Icon, label, shortcut, active, pressed, expanded, className, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`tb-button${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <Icon size={19} strokeWidth={1.75} aria-hidden="true" />
      {children}
      <span className="tooltip" role="tooltip">
        {label}
        {shortcut && <kbd>{shortcut}</kbd>}
      </span>
    </button>
  );
}

interface ToolbarProps {
  tool: Tool;
  showDraw: boolean;
  frozen: boolean;
  mirrorX: boolean;
  mirrorY: boolean;
  chaos: boolean;
  panelOpen: boolean;
  onTool: (tool: Tool) => void;
  onFrozen: (frozen: boolean) => void;
  onMirrorX: (on: boolean) => void;
  onMirrorY: (on: boolean) => void;
  onChaos: () => void;
  onClear: () => void;
  onTogglePanel: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const { tool, showDraw, frozen, mirrorX, mirrorY, chaos, panelOpen } = props;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canFullscreen = document.fullscreenEnabled;

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Glow controls">
      <div className="tb-group" role="group" aria-label="Tools">
        <IconButton
          icon={Waves}
          label={showDraw ? 'Steer tubes' : 'Flow and draw'}
          shortcut="1"
          active={tool === 'flow'}
          pressed={tool === 'flow'}
          onClick={() => props.onTool('flow')}
        />
        {showDraw && (
          <IconButton icon={Pencil} label="Draw" active={tool === 'draw'} pressed={tool === 'draw'} onClick={() => props.onTool('draw')} />
        )}
        <IconButton
          icon={Orbit}
          label="Black hole"
          shortcut="B"
          active={tool === 'hole'}
          pressed={tool === 'hole'}
          onClick={() => props.onTool('hole')}
        />
        <IconButton
          icon={Bomb}
          label="Explosion"
          shortcut="E"
          active={tool === 'explode'}
          pressed={tool === 'explode'}
          onClick={() => props.onTool('explode')}
        />
      </div>
      <span className="tb-divider" aria-hidden="true" />
      <div className="tb-group" role="group" aria-label="Effects">
        <IconButton
          icon={FlipHorizontal2}
          label="Mirror left and right"
          active={mirrorX}
          pressed={mirrorX}
          onClick={() => props.onMirrorX(!mirrorX)}
        />
        <IconButton
          icon={FlipVertical2}
          label="Mirror top and bottom"
          active={mirrorY}
          pressed={mirrorY}
          onClick={() => props.onMirrorY(!mirrorY)}
        />
        <IconButton
          icon={Snowflake}
          label={frozen ? 'Unfreeze time' : 'Freeze time'}
          shortcut="F"
          active={frozen}
          pressed={frozen}
          onClick={() => props.onFrozen(!frozen)}
        />
        <IconButton
          icon={Tornado}
          label="Chaos"
          shortcut="X"
          active={chaos}
          pressed={chaos}
          className={chaos ? `is-chaos${frozen ? ' is-paused' : ''}` : undefined}
          onClick={props.onChaos}
        />
      </div>
      <span className="tb-divider" aria-hidden="true" />
      <div className="tb-group" role="group" aria-label="Canvas">
        <IconButton icon={Eraser} label="Clear canvas" shortcut="C" onClick={props.onClear} />
        <IconButton
          icon={SlidersHorizontal}
          label={panelOpen ? 'Close settings' : 'Settings'}
          active={panelOpen}
          expanded={panelOpen}
          onClick={props.onTogglePanel}
        />
        {canFullscreen && (
          <IconButton
            icon={isFullscreen ? Minimize : Maximize}
            label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            pressed={isFullscreen}
            onClick={toggleFullscreen}
          />
        )}
      </div>
    </div>
  );
}
