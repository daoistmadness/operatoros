import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type ModuleWithNamedExport<Name extends string, Component extends ComponentType> = {
  [Key in Name]: Component;
};

export function lazyNamedRoute<Name extends string, Component extends ComponentType>(
  importer: () => Promise<ModuleWithNamedExport<Name, Component>>,
  exportName: Name,
): LazyExoticComponent<Component> {
  return lazy(async () => {
    const module = await importer();
    return { default: module[exportName] };
  });
}
