// Tip the view up so a screenshot is mostly sky — the street only ever shows a
// narrow band of it, which makes cloud shape hard to judge from a normal frame.
g.player.pitch = 0.95;
g.viewModel.root.visible = false;
return { pitch: g.player.pitch, hidden: !g.viewModel.root.visible };
