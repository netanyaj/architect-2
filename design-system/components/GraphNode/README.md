# GraphNode

The Agents graph.

- **Nodes:**
  - `.node` cards for the trigger, agents and output;
  - `.node.tool` (dashed) for tools and knowledge;
  - `.node.sel` for the agent whose settings are open on the right.
- **Edges:**
  - solid lines are hand-offs, labelled with `.elabel` ("Hands over findings");
  - dashed lines mean "uses".
- **Controls:** zoom and fit sit bottom-right. The graph is the default view; clicking a node opens its settings.
