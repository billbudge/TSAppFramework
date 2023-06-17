import { SelectionSet } from '../../src/collections.js';
import { Theme, getEdgeBezier, hitTestRect, roundRectPath, bezierEdgePath, hitTestBezier, inFlagPath, outFlagPath, measureNameValuePairs, FileController } from '../../src/diagrams.js';
import { getExtents, expandRect } from '../../src/geometry.js';
import { ScalarProp, ChildArrayProp, ReferenceProp, IdProp, EventBase, copyItems, Serialize, Deserialize, getLowestCommonAncestor, ancestorInSet, reduceToRoots, TransactionManager, HistoryManager } from '../../src/dataModels.js';
// import * as Canvas2SVG from '../../third_party/canvas2svg/canvas2svg.js'
//------------------------------------------------------------------------------
// Parse type strings into type objects.
export class Pin {
    copy() {
        let type = this.type;
        if (type)
            type = type.copy();
        return new Pin(this.typeString, type, this.name);
    }
    constructor(typeString, type, name) {
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.baseline = 0;
        this.typeString = typeString;
        this.name = name;
        this.type = type;
    }
}
export class Type {
    get needsLayout() {
        return this.width === 0;
    }
    copy() {
        return new Type(this.typeString, this.inputs.map(pin => pin.copy()), this.outputs.map(pin => pin.copy()), this.name);
    }
    constructor(typeString, inputs, outputs, name) {
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.typeString = typeString;
        this.inputs = inputs;
        this.outputs = outputs;
        this.name = name;
    }
}
const valueType = new Type('v', [], []), starType = new Type('*', [], []);
export function stringifyType(type) {
    if (type.typeString == 'v' || type.typeString == '*')
        return type.typeString;
    let s = '[';
    function stringifyName(item) {
        if (item.name)
            s += '(' + item.name + ')';
    }
    function stringifyPin(pin) {
        s += pin.type ? stringifyType(pin.type) : pin.typeString;
        stringifyName(pin);
    }
    if (type.inputs)
        type.inputs.forEach(input => stringifyPin(input));
    s += ',';
    if (type.outputs)
        type.outputs.forEach(output => stringifyPin(output));
    s += ']';
    stringifyName(type);
    return s;
}
// export type TypeVisitor = (type: Type, parent: Type | undefined) => void;
// export function forEachType(type: Type, callback: TypeVisitor) {
//   callback(type, undefined);
//   if (type.inputs)
//     type.inputs.forEach(input => forEachType(input.type, callback));
//   if (type.outputs)
//     type.outputs.forEach(output => forEachType(output.type, callback));
// }
export class TypeParser {
    constructor() {
        this.map_ = new Map();
        this.addType('v', valueType);
        this.addType('*', starType);
    }
    addType(s, type) {
        let result = this.map_.get(s);
        if (!result) {
            this.map_.set(s, type);
            result = type;
        }
        return result;
    }
    get(s) {
        return this.map_.get(s);
    }
    has(s) {
        return this.map_.has(s);
    }
    add(s) {
        let type = this.map_.get(s);
        if (type)
            return type;
        const self = this;
        let j = 0;
        // Close over j to avoid extra return values.
        function parseName() {
            let name;
            if (s[j] === '(') {
                let i = j + 1;
                j = s.indexOf(')', i);
                if (j > i)
                    name = s.substring(i, j);
                j++;
            }
            return name;
        }
        function parsePin() {
            let i = j;
            // value types
            if (s[j] === 'v') {
                j++;
                return new Pin('v', valueType, parseName());
            }
            // wildcard types
            if (s[j] === '*') {
                j++;
                return new Pin('*', starType, parseName());
            }
            // function types
            let type = parseFunction(), typeString = s.substring(i, j);
            // Add the pin type, without label.
            type = self.addType(typeString, type);
            return new Pin(typeString, type, parseName());
        }
        function parseFunction() {
            let i = j;
            if (s[j] === '[') {
                j++;
                let inputs = new Array, outputs = new Array;
                while (s[j] !== ',') {
                    inputs.push(parsePin());
                }
                j++;
                while (s[j] !== ']') {
                    outputs.push(parsePin());
                }
                j++;
                const typeString = s.substring(i, j);
                let type = new Type(typeString, inputs, outputs);
                type = self.addType(typeString, type);
                return type;
            }
            else if (s[j] === 'v' || s[j] === '*') {
                let type = new Type(s[j], [], []);
                type = self.addType(type.typeString, type);
                return type;
            }
            else {
                throw new Error('Invalid type string: ' + s);
            }
        }
        type = parseFunction();
        if (type) {
            const name = parseName();
            if (name) {
                // The top level function type includes the label, so duplicate
                // type and pins.
                const inputs = type.inputs.map(pin => new Pin(pin.typeString, pin.type, pin.name)), outputs = type.outputs.map(pin => new Pin(pin.typeString, pin.type, pin.name));
                type = new Type(s, inputs, outputs, name);
            }
            type = this.addType(s, type);
        }
        return type;
    }
    addLabel(typeString, label) {
        if (label === undefined || label === '')
            return typeString;
        const type = this.add(typeString), copy = type.copy();
        copy.name = label;
        return stringifyType(copy);
    }
    addInputLabel(typeString, label) {
        const type = this.add(typeString), copy = type.copy();
        if (copy.inputs.length > 0)
            copy.inputs[0].name = label;
        return stringifyType(copy);
    }
    addOutputLabel(typeString, label) {
        const type = this.add(typeString), copy = type.copy();
        if (copy.outputs.length > 0)
            copy.outputs[0].name = label;
        return stringifyType(copy);
    }
    // Removes any trailing label.
    trimTypeString(typeString) {
        if (typeString[typeString.length - 1] === ')')
            typeString = typeString.substring(0, typeString.lastIndexOf('('));
        return typeString;
    }
    // Removes all labels from type string.
    getUnlabeledTypeString(typeString) {
        let result = '', label = 0;
        while (true) {
            label = typeString.indexOf('(');
            if (label <= 0)
                break;
            result += typeString.substring(0, label);
            label = typeString.indexOf(')', label);
            if (label <= 0)
                break;
            typeString = typeString.substring(label + 1, typeString.length);
        }
        return result + typeString;
    }
    splitTypeString(typeString) {
        let j = 0, level = 0;
        while (true) {
            if (typeString[j] === '[')
                level++;
            else if (typeString[j] === ']')
                level--;
            else if (typeString[j] === ',')
                if (level === 1)
                    return j;
            j++;
        }
    }
    hasOutput(typeString) {
        return !typeString.endsWith(',]');
    }
}
const globalTypeParser_ = new TypeParser(), nullFunction = globalTypeParser_.add('[,]');
//------------------------------------------------------------------------------
// Implement type-safe interfaces as well as a raw data interface for
// cloning, serialization, etc.
const idProp = new IdProp('id'), xProp = new ScalarProp('x'), yProp = new ScalarProp('y'), nameProp = new ScalarProp('name'), typeStringProp = new ScalarProp('typeString'), widthProp = new ScalarProp('width'), heightProp = new ScalarProp('height'), srcProp = new ReferenceProp('src'), srcPinProp = new ScalarProp('srcPin'), dstProp = new ReferenceProp('dst'), dstPinProp = new ScalarProp('dstPin'), nonWiresProp = new ChildArrayProp('nonWires'), wiresProp = new ChildArrayProp('wires'), functionchartProp = new ReferenceProp('functionchart');
class NonWireTemplate {
    constructor() {
        this.id = idProp;
        this.x = xProp;
        this.y = yProp;
    }
}
class ElementTemplate extends NonWireTemplate {
    constructor(typeName) {
        super();
        this.name = nameProp;
        this.typeString = typeStringProp;
        this.properties = [this.id, this.x, this.y, this.name, this.typeString];
        this.typeName = typeName;
    }
}
class PseudoelementTemplate extends NonWireTemplate {
    constructor(typeName) {
        super();
        this.typeString = typeStringProp;
        this.properties = [this.id, this.x, this.y, this.typeString];
        this.typeName = typeName;
    }
}
class WireTemplate {
    constructor() {
        this.typeName = 'wire';
        this.src = srcProp;
        this.srcPin = srcPinProp;
        this.dst = dstProp;
        this.dstPin = dstPinProp;
        this.properties = [this.src, this.srcPin, this.dst, this.dstPin];
    }
}
class FunctionchartTemplate extends NonWireTemplate {
    constructor() {
        super(...arguments);
        this.typeName = 'functionchart';
        this.width = widthProp;
        this.height = heightProp;
        this.name = nameProp;
        this.typeString = typeStringProp;
        this.nonWires = nonWiresProp;
        this.wires = wiresProp;
        this.properties = [this.id, this.x, this.y, this.width, this.height, this.name,
            this.typeString, this.nonWires, this.wires];
    }
}
class FunctionInstanceTemplate extends NonWireTemplate {
    constructor() {
        super(...arguments);
        this.typeName = 'instance';
        this.functionchart = functionchartProp;
        this.properties = [this.id, this.x, this.y, this.functionchart];
    }
}
const binopTemplate = new ElementTemplate('binop'), unopTemplate = new ElementTemplate('unop'), condTemplate = new ElementTemplate('cond'), elementTemplate = new ElementTemplate('element'), inputPseudoelementTemplate = new PseudoelementTemplate('input'), outputPseudoelementTemplate = new PseudoelementTemplate('output'), literalPseudoelementTemplate = new PseudoelementTemplate('literal'), wireTemplate = new WireTemplate(), functionchartTemplate = new FunctionchartTemplate(), functionInstanceTemplate = new FunctionInstanceTemplate();
const defaultPoint = { x: 0, y: 0 }, defaultPointWithNormal = { x: 0, y: 0, nx: 0, ny: 0 }, defaultBezierCurve = [
    defaultPointWithNormal, defaultPoint, defaultPoint, defaultPointWithNormal
];
class ElementBase {
    constructor(id) {
        this.globalPosition = defaultPoint;
        this.type = nullFunction;
        this.inWires = new Array(); // one input per pin (no fan in).
        this.outWires = new Array(); // multiple outputs per pin (fan out).
        this.id = id;
    }
}
export class Element extends ElementBase {
    get x() { return this.template.x.get(this) || 0; }
    set x(value) { this.template.x.set(this, value); }
    get y() { return this.template.y.get(this) || 0; }
    set y(value) { this.template.y.set(this, value); }
    get typeString() { return this.template.typeString.get(this); }
    set typeString(value) { this.template.typeString.set(this, value); }
    constructor(context, template, id) {
        super(id);
        this.context = context;
        this.template = template;
    }
}
export class Pseudoelement extends ElementBase {
    get x() { return this.template.x.get(this) || 0; }
    set x(value) { this.template.x.set(this, value); }
    get y() { return this.template.y.get(this) || 0; }
    set y(value) { this.template.y.set(this, value); }
    get typeString() { return this.template.typeString.get(this); }
    set typeString(value) { this.template.typeString.set(this, value); }
    constructor(context, template, id) {
        super(id);
        this.context = context;
        this.template = template;
        switch (this.template.typeName) {
            case 'input':
                this.typeString = '[,*]';
                break;
            case 'output':
                this.typeString = '[*,]';
                break;
            case 'literal':
                this.typeString = '[,v]';
                break;
        }
    }
}
export class Wire {
    get src() { return this.template.src.get(this); }
    set src(value) { this.template.src.set(this, value); }
    get srcPin() { return this.template.srcPin.get(this); }
    set srcPin(value) { this.template.srcPin.set(this, value); }
    get dst() { return this.template.dst.get(this); }
    set dst(value) { this.template.dst.set(this, value); }
    get dstPin() { return this.template.dstPin.get(this); }
    set dstPin(value) { this.template.dstPin.set(this, value); }
    constructor(context) {
        this.template = wireTemplate;
        this.bezier = defaultBezierCurve;
        this.context = context;
        this.srcPin = -1;
        this.dstPin = -1;
    }
}
export class Functionchart {
    get x() { return this.template.x.get(this) || 0; }
    set x(value) { this.template.x.set(this, value); }
    get y() { return this.template.y.get(this) || 0; }
    set y(value) { this.template.y.set(this, value); }
    get width() { return this.template.width.get(this) || 0; }
    set width(value) { this.template.width.set(this, value); }
    get height() { return this.template.height.get(this) || 0; }
    set height(value) { this.template.height.set(this, value); }
    get typeString() { return this.template.typeString.get(this); }
    set typeString(value) { this.template.typeString.set(this, value); }
    get nonWires() { return this.template.nonWires.get(this); }
    get wires() { return this.template.wires.get(this); }
    constructor(context, id) {
        this.template = functionchartTemplate;
        this.globalPosition = defaultPoint;
        this.type = nullFunction;
        this.context = context;
        this.id = id;
    }
}
export class FunctionInstance extends ElementBase {
    get x() { return this.template.x.get(this) || 0; }
    set x(value) { this.template.x.set(this, value); }
    get y() { return this.template.y.get(this) || 0; }
    set y(value) { this.template.y.set(this, value); }
    get functionchart() { return this.template.functionchart.get(this); }
    set functionchart(value) { this.template.functionchart.set(this, value); }
    constructor(context, id) {
        super(id);
        this.template = functionInstanceTemplate;
        this.context = context;
    }
}
export class FunctionchartContext extends EventBase {
    constructor() {
        super();
        this.highestId = 0; // 0 stands for no id.
        this.referentMap = new Map();
        this.elements = new Set;
        this.functioncharts = new Set;
        this.wires = new Set;
        this.sorted = new Array(); // Topologically sorted elements.
        this.selection = new SelectionSet();
        const self = this;
        this.transactionManager = new TransactionManager();
        this.addHandler('changed', this.transactionManager.onChanged.bind(this.transactionManager));
        function update() {
            if (!self.sorted)
                self.sorted = self.topologicalSort();
            self.makeConsistent();
        }
        function updateAndValidate() {
            update();
            if (!self.isValidFunctionchart()) {
                self.transactionManager.cancelTransaction();
            }
        }
        this.transactionManager.addHandler('transactionEnding', updateAndValidate);
        this.transactionManager.addHandler('didUndo', update);
        this.transactionManager.addHandler('didRedo', update);
        this.historyManager = new HistoryManager(this.transactionManager, this.selection);
        const root = new Functionchart(this, this.highestId++);
        this.functionchart = root;
        this.insertFunctionchart(root, undefined);
    }
    get root() {
        return this.functionchart;
    }
    set root(root) {
        if (this.functionchart) {
            // This removes all elements, functioncharts, and wires.
            this.removeItem(this.functionchart);
        }
        this.functionchart = root;
        this.insertFunctionchart(root, undefined);
    }
    newElement(typeName) {
        const nextId = ++this.highestId;
        let template, typeString;
        switch (typeName) {
            case 'binop':
                template = binopTemplate;
                typeString = '[vv,v]';
                break;
            case 'unop':
                template = unopTemplate;
                typeString = '[v,v]';
                break;
            case 'cond':
                template = condTemplate;
                typeString = '[v**,*](?)';
                break;
            case 'element':
                template = elementTemplate;
                typeString = '[,]';
                break;
            default: throw new Error('Unknown element type: ' + typeName);
        }
        const result = new Element(this, template, nextId);
        result.typeString = typeString;
        this.referentMap.set(nextId, result);
        return result;
    }
    newPseudoelement(typeName) {
        const nextId = ++this.highestId;
        let template;
        switch (typeName) {
            case 'input':
                template = inputPseudoelementTemplate;
                break;
            case 'output':
                template = outputPseudoelementTemplate;
                break;
            case 'literal':
                template = literalPseudoelementTemplate;
                break;
            default: throw new Error('Unknown pseudoelement type: ' + typeName);
        }
        const result = new Pseudoelement(this, template, nextId);
        this.referentMap.set(nextId, result);
        return result;
    }
    newWire(src, srcPin, dst, dstPin) {
        const result = new Wire(this);
        result.src = src;
        result.srcPin = srcPin;
        result.dst = dst;
        result.dstPin = dstPin;
        return result;
    }
    newFunctionchart() {
        const nextId = ++this.highestId;
        const result = new Functionchart(this, nextId);
        this.referentMap.set(nextId, result);
        return result;
    }
    newFunctionInstance() {
        const nextId = ++this.highestId;
        const result = new FunctionInstance(this, nextId);
        this.referentMap.set(nextId, result);
        return result;
    }
    visitAll(item, visitor) {
        const self = this;
        visitor(item);
        if (item instanceof Functionchart) {
            item.nonWires.forEach(t => self.visitAll(t, visitor));
            item.wires.forEach(t => self.visitAll(t, visitor));
        }
    }
    reverseVisitAll(item, visitor) {
        const self = this;
        if (item instanceof Functionchart) {
            item.wires.forEachReverse(t => self.reverseVisitAll(t, visitor));
            item.nonWires.forEachReverse(t => self.reverseVisitAll(t, visitor));
        }
        visitor(item);
    }
    visitNonWires(item, visitor) {
        const self = this;
        visitor(item);
        if (item instanceof Functionchart) {
            item.nonWires.forEach(item => self.visitNonWires(item, visitor));
        }
    }
    reverseVisitNonWires(item, visitor) {
        const self = this;
        if (item instanceof Functionchart) {
            item.nonWires.forEachReverse(item => self.reverseVisitNonWires(item, visitor));
        }
        visitor(item);
    }
    visitWires(functionchart, visitor) {
        const self = this;
        functionchart.wires.forEach(t => visitor(t));
        functionchart.nonWires.forEach(t => {
            if (t instanceof Functionchart)
                self.visitWires(t, visitor);
        });
    }
    reverseVisitWires(functionchart, visitor) {
        const self = this;
        functionchart.nonWires.forEachReverse(t => {
            if (t instanceof Functionchart)
                self.reverseVisitWires(t, visitor);
        });
        functionchart.wires.forEach(t => visitor(t));
    }
    getGrandParent(item) {
        let result = item.parent;
        if (result)
            result = result.parent;
        return result;
    }
    forInWires(element, visitor) {
        element.inWires.forEach(wire => {
            if (wire)
                visitor(wire);
        });
    }
    forOutWires(element, visitor) {
        element.outWires.forEach((wires) => {
            wires.forEach(wire => visitor(wire));
        });
    }
    // Gets the translation to move an item from its current parent to
    // newParent.
    getToParent(item, newParent) {
        const oldParent = item.parent;
        let dx = 0, dy = 0;
        if (oldParent) {
            const global = oldParent.globalPosition;
            dx += global.x;
            dy += global.y;
        }
        if (newParent) {
            const global = newParent.globalPosition;
            dx -= global.x;
            dy -= global.y;
        }
        return { x: dx, y: dy };
    }
    setGlobalPosition(item) {
        const x = item.x, y = item.y, parent = item.parent;
        if (parent) {
            // console.log(item.type, parent.type, parent.globalPosition);
            const global = parent.globalPosition;
            if (global) {
                item.globalPosition = { x: x + global.x, y: y + global.y };
            }
        }
        else {
            item.globalPosition = { x: x, y: y };
        }
    }
    getGraphInfo() {
        return {
            elements: this.elements,
            functioncharts: this.functioncharts,
            wires: this.wires,
            interiorWires: this.wires,
            inWires: new Set(),
            outWires: new Set(),
        };
    }
    getSubgraphInfo(items) {
        const self = this, elements = new Set(), functioncharts = new Set(), wires = new Set(), interiorWires = new Set(), inWires = new Set(), outWires = new Set();
        // First collect Elements and Functioncharts.
        items.forEach(item => {
            this.visitNonWires(item, (item) => {
                if (item instanceof Functionchart)
                    functioncharts.add(item);
                else
                    elements.add(item);
            });
        });
        // Now collect and classify wires that connect to them.
        items.forEach(item => {
            function addWire(wire) {
                // Stop if we've already processed this transtion (handle transitions from a element to itself.)
                if (wires.has(wire))
                    return;
                wires.add(wire);
                const src = wire.src, dst = wire.dst, srcInside = elements.has(src), dstInside = elements.has(dst);
                if (srcInside) {
                    if (dstInside) {
                        interiorWires.add(wire);
                    }
                    else {
                        outWires.add(wire);
                    }
                }
                if (dstInside) {
                    if (!srcInside) {
                        inWires.add(wire);
                    }
                }
            }
            if (item instanceof ElementBase) {
                self.forInWires(item, addWire);
                self.forOutWires(item, addWire);
            }
        });
        return {
            elements: elements,
            functioncharts: functioncharts,
            wires: wires,
            interiorWires: interiorWires,
            inWires: inWires,
            outWires: outWires,
        };
    }
    getConnectedElements(elements, upstream, downstream) {
        const result = new Set();
        elements = elements.slice(0); // Copy input array
        while (elements.length > 0) {
            const element = elements.pop();
            result.add(element);
            if (upstream) {
                this.forInWires(element, wire => {
                    const src = wire.src;
                    if (!result.has(src))
                        elements.push(src);
                });
            }
            if (downstream) {
                this.forOutWires(element, wire => {
                    const dst = wire.dst;
                    if (!result.has(dst))
                        elements.push(dst);
                });
            }
        }
        return result;
    }
    // TODO make transaction manager private?
    beginTransaction(name) {
        this.transactionManager.beginTransaction(name);
    }
    endTransaction() {
        this.transactionManager.endTransaction();
    }
    cancelTransaction(name) {
        this.transactionManager.cancelTransaction();
    }
    getUndo() {
        return this.historyManager.getUndo();
    }
    undo() {
        this.historyManager.undo();
    }
    getRedo() {
        return this.historyManager.getRedo();
    }
    redo() {
        this.historyManager.redo();
    }
    select(item) {
        this.selection.add(item);
    }
    selectionContents() {
        return this.selection.contents();
    }
    selectedElements() {
        const result = new Array();
        this.selection.forEach(item => {
            if (item instanceof Element || item instanceof FunctionInstance)
                result.push(item);
        });
        return result;
    }
    selectedAllElements() {
        const result = new Array();
        this.selection.forEach(item => {
            if (item instanceof ElementBase)
                result.push(item);
        });
        return result;
    }
    selectedNonWires() {
        const result = new Array();
        this.selection.forEach(item => {
            if (!(item instanceof Wire))
                result.push(item);
        });
        return result;
    }
    reduceSelection() {
        const selection = this.selection;
        const roots = reduceToRoots(selection.contents(), selection);
        // Reverse, to preserve the previous order of selection.
        selection.set(roots.reverse());
    }
    disconnectSelection() {
        const self = this;
        this.selectedAllElements().forEach(element => {
            self.forInWires(element, wire => this.deleteItem(wire));
            self.forOutWires(element, wire => this.deleteItem(wire));
        });
    }
    selectInteriorWires() {
        const self = this, graphInfo = this.getSubgraphInfo(this.selectedAllElements());
        graphInfo.interiorWires.forEach(wire => self.selection.add(wire));
    }
    selectConnectedElements(upstream) {
        const selectedElements = this.selectedAllElements(), connectedElements = this.getConnectedElements(selectedElements, upstream, true);
        this.selection.set(Array.from(connectedElements));
    }
    addItem(item, parent) {
        const oldParent = item.parent;
        if (!parent)
            parent = this.functionchart;
        if (oldParent === parent)
            return item;
        // At this point we can add item to parent.
        if (!(item instanceof Wire)) {
            const translation = this.getToParent(item, parent);
            item.x += translation.x;
            item.y += translation.y;
        }
        if (oldParent)
            this.deleteItem(item);
        if (item instanceof Wire) {
            parent.wires.append(item);
        }
        else {
            parent.nonWires.append(item);
        }
        return item;
    }
    addItems(items, parent) {
        // Add elements first, then transitions, so the context can track transitions.
        for (let item of items) {
            if (!(item instanceof Wire))
                this.addItem(item, parent);
        }
        for (let item of items) {
            if (item instanceof Wire)
                this.addItem(item, parent);
        }
    }
    deleteItem(item) {
        if (item.parent) {
            if (item instanceof Wire) {
                item.parent.wires.remove(item);
            }
            else {
                item.parent.nonWires.remove(item);
            }
        }
        this.selection.delete(item);
    }
    deleteItems(items) {
        const self = this;
        items.forEach(item => self.deleteItem(item));
    }
    copy() {
        const Functionchart = this.functionchart, selection = this.selection;
        selection.set(this.selectedNonWires());
        this.selectInteriorWires();
        this.reduceSelection();
        const selected = selection.contents(), map = new Map(), copies = copyItems(selected, this, map);
        selected.forEach(item => {
            if (!(item instanceof Wire)) {
                const copy = map.get(item.id);
                if (copy) {
                    const translation = this.getToParent(item, Functionchart);
                    copy.x += translation.x;
                    copy.y += translation.y;
                }
            }
        });
        return copies;
    }
    paste(items) {
        this.transactionManager.beginTransaction('paste');
        items.forEach(item => {
            // Offset paste so copies don't overlap with the originals.
            if (!(item instanceof Wire)) {
                item.x += 16;
                item.y += 16;
            }
        });
        const copies = copyItems(items, this); // TODO fix
        this.addItems(copies, this.functionchart);
        this.selection.set(copies);
        this.transactionManager.endTransaction();
        return copies;
    }
    deleteSelectionHelper() {
        this.reduceSelection();
        this.disconnectSelection();
        this.deleteItems(this.selection.contents());
    }
    cut() {
        this.transactionManager.beginTransaction('cut');
        const result = this.copy();
        this.deleteSelectionHelper();
        this.transactionManager.endTransaction();
        return result;
    }
    deleteSelection() {
        this.transactionManager.beginTransaction('delete');
        this.deleteSelectionHelper();
        this.transactionManager.endTransaction();
    }
    connectInput(element, pin, pinToPoint) {
        const elementParent = element.parent, p = pinToPoint(element, pin), junction = this.newPseudoelement('input');
        junction.x = p.x - 32;
        junction.y = p.y;
        this.addItem(junction, elementParent);
        const wire = this.newWire(junction, 0, element, pin);
        this.addItem(wire, elementParent);
        return { junction, wire };
    }
    connectOutput(element, pin, pinToPoint) {
        const elementParent = element.parent, p = pinToPoint(element, pin), junction = this.newPseudoelement('output');
        junction.x = p.x + 32;
        junction.y = p.y;
        this.addItem(junction, elementParent);
        const wire = this.newWire(element, pin, junction, 0);
        this.addItem(wire, elementParent);
        return { junction, wire };
    }
    completeElements(elements, inputToPoint, outputToPoint) {
        const self = this;
        // Add junctions for disconnected pins on elements.
        elements.forEach(element => {
            const inputs = element.inWires, outputs = element.outWires;
            for (let pin = 0; pin < inputs.length; pin++) {
                if (inputs[pin] === undefined)
                    self.connectInput(element, pin, inputToPoint);
            }
            for (let pin = 0; pin < outputs.length; pin++) {
                if (outputs[pin].length === 0)
                    self.connectOutput(element, pin, outputToPoint);
            }
        });
    }
    isValidWire(wire) {
        const src = wire.src, dst = wire.dst;
        if (!src || !dst)
            return false;
        if (src === dst)
            return false;
        const srcPin = wire.srcPin, dstPin = wire.dstPin;
        if (srcPin < 0 || srcPin >= src.type.outputs.length)
            return false;
        if (dstPin < 0 || dstPin >= dst.type.inputs.length)
            return false;
        const srcType = src.type.outputs[srcPin].type, dstType = dst.type.inputs[dstPin].type;
        // starType is wildcard type. // TODO notion of type covariance.
        if (srcType !== starType && dstType !== starType && srcType !== dstType)
            return false;
        return true;
    }
    topologicalSort() {
        const visiting = new Set(), visited = new Set(), sorted = new Array();
        let cycle = false;
        function visit(element) {
            if (visited.has(element))
                return;
            if (visiting.has(element)) {
                cycle = true;
                return;
            }
            visiting.add(element);
            element.outWires.forEach(wires => {
                wires.forEach(wire => {
                    visit(wire.dst);
                });
            });
            if (cycle)
                return;
            visiting.delete(element);
            visited.add(element);
            sorted.push(element);
        }
        this.elements.forEach(element => {
            if (!visited.has(element) && !visiting.has(element))
                visit(element);
        });
        return sorted;
    }
    isValidFunctionchart() {
        const self = this, invalidWires = new Array(), graphInfo = this.getGraphInfo();
        // Check wires.
        graphInfo.wires.forEach(wire => {
            if (!self.isValidWire(wire))
                invalidWires.push(wire);
        });
        if (invalidWires.length !== 0)
            return false;
        if (!this.sorted)
            this.sorted = this.topologicalSort();
        return this.sorted.length === this.elements.size;
    }
    makeConsistent() {
        const self = this;
        // TODO use topological sort to traverse graph and make types consistent.
        if (!this.sorted)
            this.sorted = this.topologicalSort();
        // Make sure wires between elements are in lowest common parent functionchart.
        this.wires.forEach(wire => {
            const src = wire.src, dst = wire.dst, srcParent = src.parent, dstParent = dst.parent, lca = getLowestCommonAncestor(srcParent, dstParent);
            if (wire.parent !== lca) {
                self.deleteItem(wire);
                self.addItem(wire, lca);
            }
        });
        // Update pseudoelement, conditional, functionchart, and function instance types.
        this.reverseVisitNonWires(this.functionchart, item => {
            // Update types of inputs and outputs.
            if (item instanceof Pseudoelement) {
                if (item.template.typeName === 'input' || item.template.typeName === 'literal') {
                    const type = starType, // self.resolveOutputType(item, 0) || starType,
                    label = item.type.outputs[0].name || '', newTypeString = '[,' + type.typeString + '(' + label + ')' + ']'; // TODO move to parser
                    if (item.typeString !== newTypeString)
                        item.typeString = newTypeString;
                }
                else if (item.template.typeName === 'output') {
                    const type = starType, // self.resolveInputType(item, 0) || starType,
                    label = item.type.inputs[0].name || '', newTypeString = '[' + type.typeString + '(' + label + ')' + ',]';
                    if (item.typeString !== newTypeString)
                        item.typeString = newTypeString;
                }
            }
            else if (item instanceof Element && item.template.typeName === 'cond') {
                const type = starType, // self.resolveOutputType(item, 0) ||
                //self.resolveInputType(item, 1) ||
                //self.resolveInputType(item, 2) || starType,
                typeString = type.typeString, newTypeString = '[v' + typeString + typeString + ',' + typeString + '](?)';
                if (item.typeString !== newTypeString)
                    item.typeString = newTypeString;
            }
            else if (item instanceof Functionchart) {
                const newTypeString = self.getFunctionchartTypeString(item);
                if (item.typeString !== newTypeString)
                    item.typeString = newTypeString;
            }
        });
        this.visitNonWires(this.functionchart, item => {
            if (item instanceof FunctionInstance) {
                if (item.type !== item.functionchart.type) {
                    item.type = item.functionchart.type;
                }
            }
        });
        // // Delete any empty functioncharts (except for the root functionchart).
        // graphInfo.functioncharts.forEach(functionchart => {
        //   if (functionchart.parent &&
        //       functionchart.nonWires.length === 0)
        //     self.deleteItem(functionchart);
        // });
    }
    replaceElement(element, newElement) {
        const type = element.type, newType = newElement.type;
        // Add newElement right after element. Both should be present as we
        // rewire them.
        if (element.parent !== newElement.parent) {
            this.deleteItem(newElement);
        }
        if (element.parent) {
            this.addItem(newElement, element.parent);
        }
        newElement.x = element.x;
        newElement.y = element.y;
        // Update all incoming and outgoing wires if possible; otherwise they
        // are deleted.
        const srcChange = new Array(), dstChange = new Array();
        function canRewire(index, pins, newPins) {
            if (index >= newPins.length)
                return false;
            const type = globalTypeParser_.trimTypeString(pins[index].typeString), newType = globalTypeParser_.trimTypeString(newPins[index].typeString);
            return type === '*' || type === newType;
        }
        this.forInWires(element, wire => {
            if (canRewire(wire.dstPin, type.inputs, newType.inputs)) {
                dstChange.push(wire);
            }
            else {
                this.deleteItem(wire);
            }
        });
        this.forOutWires(element, wire => {
            if (canRewire(wire.srcPin, type.outputs, newType.outputs)) {
                srcChange.push(wire);
            }
            else {
                this.deleteItem(wire);
            }
        });
        srcChange.forEach(wire => {
            wire.src = newElement;
        });
        dstChange.forEach(function (wire) {
            wire.dst = newElement;
        });
        this.deleteItem(element);
    }
    updateType(instance) {
        const newInstance = this.newFunctionInstance();
        newInstance.functionchart = instance.functionchart;
        this.replaceElement(instance, newInstance);
    }
    exportElement(element) {
        const result = this.newElement('element'), typeString = (element instanceof Element) ? element.typeString : element.type.typeString;
        result.typeString = '[,' + typeString + ']';
        // TODO eliminate potential dangling wires by replacing element.
        return result;
    }
    exportElements(elements) {
        const self = this, selection = this.selection;
        // Open each non-input/output element.
        elements.forEach(element => {
            selection.delete(element);
            const newElement = self.exportElement(element);
            self.replaceElement(element, newElement);
            selection.add(newElement);
        });
    }
    openElement(element) {
        const result = this.newElement('element'), typeString = (element instanceof Element) ? element.typeString : element.type.typeString;
        const j = globalTypeParser_.splitTypeString(typeString);
        result.typeString =
            typeString.substring(0, j) + typeString + typeString.substring(j); // TODO move to parser
        // TODO eliminate potential dangling wires by replacing element.
        return result;
    }
    openElements(elements) {
        const self = this, selection = this.selection;
        // Open each non-input/output element.
        elements.forEach(element => {
            selection.delete(element);
            const newElement = self.openElement(element);
            self.replaceElement(element, newElement);
            selection.add(newElement);
        });
    }
    group(items, grandparent, bounds) {
        const parent = this.newFunctionchart();
        parent.x = bounds.x;
        parent.y = bounds.y;
        // parent.width = bounds.width;
        // parent.height = bounds.height;
        this.addItem(parent, grandparent);
        items.forEach(item => {
            this.addItem(item, parent);
        });
    }
    resolveInputType(element, pin) {
        const inWires = element.inWires, wire = inWires[pin];
        if (wire && wire.src) {
            return wire.src.type.outputs[wire.srcPin].type;
        }
    }
    resolveOutputType(element, pin) {
        const outWires = element.outWires, array = outWires[pin], pinType = element.type.outputs[pin].type;
        for (let i = 0; i < array.length; i++) {
            const wire = array[i];
            if (wire && wire.dst) {
                return wire.dst.type.inputs[wire.dstPin].type;
                // TODO we need to check all wires and propagate the type downstream.
            }
        }
    }
    getFunctionchartTypeString(functionChart) {
        const self = this, nonWires = functionChart.nonWires.asArray(), 
        // graphInfo = this.getSubgraphInfo(nonWires),
        inputs = new Array(), outputs = new Array(), label = functionChart.type.name;
        // Add pins for inputs, outputs, and disconnected pins on elements.
        nonWires.forEach(item => {
            if (item instanceof Pseudoelement) {
                if (item.template.typeName === 'input') {
                    inputs.push(item);
                }
                else if (item.template.typeName === 'output') {
                    outputs.push(item);
                }
            }
        });
        // Sort pins so we encounter them in increasing y-order. This lets us arrange
        // the pins of the group type in an intuitive way.
        function compareJunctions(p1, p2) {
            return p1.y - p2.y;
        }
        inputs.sort(compareJunctions);
        outputs.sort(compareJunctions);
        function getPinName(type, pin) {
            let typeString = type.typeString;
            if (pin.name)
                typeString += '(' + pin.name + ')';
            return typeString;
        }
        let result = '[';
        inputs.forEach(input => {
            const type = self.resolveOutputType(input, 0);
            result += getPinName(type || starType, input.type.outputs[0]);
        });
        result += ',';
        outputs.forEach(output => {
            const type = self.resolveInputType(output, 0);
            result += getPinName(type || starType, output.type.inputs[0]);
        });
        result += ']';
        result = globalTypeParser_.addLabel(result, label); // preserve label
        // contextInputs.sort(comparePins);
        // let contextTypeString = '[';
        // contextInputs.forEach(function(input, i) {
        //   contextTypeString += input.type;
        //   input.item.index = i;
        // });
        // contextTypeString += ',]';  // no outputs
        // const info = {
        //   type: typeString,
        //   contextType: contextTypeString,
        // }
        // // Compute group pass throughs.
        // const passThroughs = new Set();
        // graphInfo.interiorWires.forEach(function(wire) {
        //   let src = self.getWireSrc(wire),
        //       srcPin = getType(src).outputs[wire.srcPin];
        //   // Trace wires, starting at input junctions.
        //   if (!isInput(src) || srcPin.type !== '*')
        //     return;
        //   let srcPinIndex = src.index,
        //       activeWires = [wire];
        //   while (activeWires.length) {
        //     wire = activeWires.pop();
        //     let dst = self.getWireDst(wire),
        //         dstPin = getType(dst).inputs[wire.dstPin];
        //     if (isOutput(dst) && dstPin.type === '*') {
        //       passThroughs.add([srcPinIndex, dst.index]);
        //     } else if (dst.passThroughs) {
        //       dst.passThroughs.forEach(function(passThrough) {
        //         if (passThrough[0] === wire.dstPin) {
        //           let outgoingWires = functionChartModel.getOutputs(dst)[passThrough[1]];
        //           outgoingWires.forEach(wire => activeWires.push(wire));
        //         }
        //       });
        //     }
        //   }
        // });
        // if (passThroughs.size) {
        //   // console.log(passThroughs);
        //   info.passThroughs = Array.from(passThroughs);
        // }
        return result;
    }
    updateItem(item) {
        const self = this;
        if (item instanceof Wire)
            return;
        // Update 'type' property.
        let typeString;
        if (item instanceof FunctionInstance) {
            const functionChart = item.functionchart;
            if (functionChart) {
                typeString = functionChart.typeString;
            }
        }
        else {
            typeString = item.typeString;
        }
        if (typeString && typeString !== item.type.typeString) {
            const newType = globalTypeParser_.add(typeString);
            item.type = newType;
        }
        // Update 'inWires' and 'outWires' properties.
        if (item instanceof ElementBase) {
            const type = item.type, inputs = type.inputs.length, outputs = type.outputs.length, inWires = item.inWires, outWires = item.outWires;
            inWires.length = inputs;
            outWires.length = outputs;
            for (let i = 0; i < outputs; i++) {
                if (outWires[i] === undefined)
                    outWires[i] = new Array();
            }
        }
        this.visitNonWires(item, item => self.setGlobalPosition(item));
    }
    insertElement(element, parent) {
        this.elements.add(element);
        element.parent = parent;
        this.updateItem(element);
        this.sorted = undefined;
    }
    removeElement(element) {
        this.elements.delete(element);
        this.sorted = undefined;
    }
    // Allow parent to be undefined for the root functionchart.
    insertFunctionchart(functionchart, parent) {
        this.functioncharts.add(functionchart);
        functionchart.parent = parent;
        this.updateItem(functionchart);
        const self = this;
        functionchart.nonWires.forEach(item => self.insertItem(item, functionchart));
        functionchart.wires.forEach(wire => self.insertWire(wire, functionchart));
    }
    removeFunctionchart(functionchart) {
        this.functioncharts.delete(functionchart);
        const self = this;
        functionchart.wires.forEach(wire => self.removeWire(wire));
        functionchart.nonWires.forEach(element => self.removeItem(element));
    }
    insertWire(wire, parent) {
        this.wires.add(wire);
        wire.parent = parent;
        this.updateItem(wire);
        this.sorted = undefined;
        const src = wire.src, srcPin = wire.srcPin, dst = wire.dst, dstPin = wire.dstPin;
        if (src && srcPin >= 0 && srcPin < src.type.outputs.length) { // TODO how to deal with temporarily invalid wire?
            const outputs = src.outWires[srcPin];
            if (!outputs.includes(wire))
                outputs.push(wire);
        }
        if (dst && dstPin >= 0 && dstPin < dst.type.inputs.length) {
            dst.inWires[dstPin] = wire;
        }
    }
    static removeWireHelper(array, wire) {
        const index = array.indexOf(wire);
        if (index >= 0) {
            array.splice(index, 1);
        }
    }
    removeWire(wire) {
        this.wires.delete(wire);
        this.sorted = undefined; // Removal might make an invalid graph valid.
        const src = wire.src, dst = wire.dst;
        if (src) {
            const outputs = src.outWires[wire.srcPin];
            FunctionchartContext.removeWireHelper(outputs, wire);
        }
        if (dst) {
            const inputs = dst.inWires;
            inputs[wire.dstPin] = undefined;
        }
    }
    insertItem(item, parent) {
        if (item instanceof Wire) {
            if (parent && this.functioncharts.has(parent)) {
                this.insertWire(item, parent);
            }
        }
        else if (item instanceof Functionchart) {
            if (parent && this.functioncharts.has(parent)) {
                this.insertFunctionchart(item, parent);
            }
        }
        else {
            if (parent && this.functioncharts.has(parent)) {
                this.insertElement(item, parent);
            }
        }
    }
    removeItem(item) {
        if (item instanceof Wire)
            this.removeWire(item);
        else if (item instanceof Functionchart)
            this.removeFunctionchart(item);
        else
            this.removeElement(item);
    }
    // DataContext interface implementation.
    valueChanged(owner, prop, oldValue) {
        if (owner instanceof Wire) {
            if (this.wires.has(owner)) {
                // Remove and reinsert changed wires.
                if (prop === wireTemplate.src) {
                    const oldSrc = oldValue, srcPin = owner.srcPin;
                    if (oldSrc && srcPin >= 0) // TODO systematize the valid wire check.
                        FunctionchartContext.removeWireHelper(oldSrc.outWires[srcPin], owner);
                }
                else if (prop === wireTemplate.dst) {
                    const oldDst = oldValue, dstPin = owner.dstPin;
                    if (oldDst && dstPin >= 0)
                        oldDst.inWires[dstPin] = undefined;
                }
                else if (prop === wireTemplate.srcPin) {
                    const src = owner.src, oldPin = oldValue;
                    if (src && oldPin >= 0) {
                        const oldOutputs = src.outWires[oldPin];
                        FunctionchartContext.removeWireHelper(oldOutputs, owner);
                    }
                }
                else if (prop === wireTemplate.dstPin) {
                    const dst = owner.dst, oldPin = oldValue;
                    if (dst && oldPin >= 0)
                        dst.inWires[oldPin] = undefined;
                }
                this.insertWire(owner, owner.parent);
            }
        }
        this.onValueChanged(owner, prop, oldValue);
        this.updateItem(owner); // Update any derived properties.
    }
    elementInserted(owner, prop, index) {
        const value = prop.get(owner).at(index);
        this.insertItem(value, owner);
        this.onElementInserted(owner, prop, index);
    }
    elementRemoved(owner, prop, index, oldValue) {
        this.removeItem(oldValue);
        this.onElementRemoved(owner, prop, index, oldValue);
    }
    resolveReference(owner, prop) {
        // Look up element id.
        const id = prop.getId(owner);
        if (!id)
            return undefined;
        return this.referentMap.get(id);
    }
    construct(typeName) {
        switch (typeName) {
            case 'binop': return this.newElement('binop');
            case 'unop': return this.newElement('unop');
            case 'cond': return this.newElement('cond');
            case 'element': return this.newElement('element');
            case 'input': return this.newPseudoelement('input');
            case 'output': return this.newPseudoelement('output');
            case 'literal': return this.newPseudoelement('literal');
            case 'wire': return this.newWire(undefined, -1, undefined, -1);
            case 'functionchart': return this.newFunctionchart();
            case 'instance': return this.newFunctionInstance();
        }
        throw new Error('Unknown type');
    }
    onChanged(change) {
        // console.log(change);
        super.onEvent('changed', change);
        return change;
    }
    onValueChanged(owner, prop, oldValue) {
        const change = { type: 'valueChanged', item: owner, prop, index: 0, oldValue };
        super.onEvent('valueChanged', change);
        return this.onChanged(change);
    }
    onElementInserted(owner, prop, index) {
        const change = { type: 'elementInserted', item: owner, prop: prop, index: index, oldValue: undefined };
        super.onEvent('elementInserted', change);
        return this.onChanged(change);
    }
    onElementRemoved(owner, prop, index, oldValue) {
        const change = { type: 'elementRemoved', item: owner, prop: prop, index: index, oldValue: oldValue };
        super.onEvent('elementRemoved', change);
        return this.onChanged(change);
    }
}
//------------------------------------------------------------------------------
class FunctionchartTheme extends Theme {
    constructor(theme, radius = 8) {
        super();
        this.textIndent = 8;
        this.textLeading = 6;
        this.knobbyRadius = 4;
        this.padding = 8;
        this.spacing = 8;
        this.minTypeWidth = 8;
        this.minTypeHeight = 8;
        this.minFunctionchartWidth = 64;
        this.minFunctionchartHeight = 32;
        Object.assign(this, theme);
        this.radius = radius;
        // Layout the base types.
        valueType.width = starType.width = radius;
        valueType.height = starType.height = radius;
    }
}
class ElementHitResult {
    constructor(item, inner) {
        this.input = -1;
        this.output = -1;
        this.item = item;
        this.inner = inner;
    }
}
class WireHitResult {
    constructor(item, inner) {
        this.item = item;
        this.inner = inner;
    }
}
class FunctionchartHitResult {
    constructor(item, inner, instancer) {
        this.item = item;
        this.inner = inner;
        this.instancer = instancer;
    }
}
var RenderMode;
(function (RenderMode) {
    RenderMode[RenderMode["Normal"] = 0] = "Normal";
    RenderMode[RenderMode["Highlight"] = 1] = "Highlight";
    RenderMode[RenderMode["HotTrack"] = 2] = "HotTrack";
    RenderMode[RenderMode["Print"] = 3] = "Print";
})(RenderMode || (RenderMode = {}));
class Renderer {
    constructor(theme) {
        this.theme = new FunctionchartTheme(theme);
    }
    begin(ctx) {
        this.ctx = ctx;
        ctx.save();
        ctx.font = this.theme.font;
    }
    end() {
        this.ctx.restore();
    }
    getItemRect(item) {
        let x, y, width, height;
        if (item instanceof Wire) {
            const extents = getExtents(item.bezier);
            x = extents.xmin;
            y = extents.ymin;
            width = extents.xmax - x;
            height = extents.ymax - y;
        }
        else {
            const global = item.globalPosition;
            x = global.x,
                y = global.y;
            if (item instanceof Functionchart) {
                width = item.width;
                height = item.height;
            }
            else {
                // Element, Pseudoelement, FunctionInstance.
                const type = item.type;
                width = type.width;
                height = type.height;
            }
        }
        return { x, y, width, height };
    }
    getBounds(items) {
        let xMin = Number.POSITIVE_INFINITY, yMin = Number.POSITIVE_INFINITY, xMax = -Number.POSITIVE_INFINITY, yMax = -Number.POSITIVE_INFINITY;
        for (let item of items) {
            const rect = this.getItemRect(item);
            xMin = Math.min(xMin, rect.x);
            yMin = Math.min(yMin, rect.y);
            xMax = Math.max(xMax, rect.x + rect.width);
            yMax = Math.max(yMax, rect.y + rect.height);
        }
        return { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin };
    }
    // Gets the bounding rect for the functionchart instancing element.
    getFunctionchartInstanceBounds(type, bounds) {
        const theme = this.theme, spacing = theme.spacing, width = type.width, height = type.height, x = bounds.x + bounds.width - width - spacing, y = bounds.y + bounds.height - height - spacing;
        return { x, y, width, height };
    }
    pinToPoint(element, index, isInput) {
        const rect = this.getItemRect(element), w = rect.width, h = rect.height, type = element.type;
        let x = rect.x, y = rect.y, pin, nx;
        if (isInput) {
            pin = type.inputs[index];
            nx = -1;
        }
        else {
            pin = type.outputs[index];
            nx = 1;
            x += w;
        }
        y += pin.y + pin.height / 2;
        return { x: x, y: y, nx: nx, ny: 0 };
    }
    // Compute sizes for an element type.
    layoutType(type) {
        const self = this, ctx = this.ctx, theme = this.theme, textSize = theme.fontSize, spacing = theme.spacing, name = type.name, inputs = type.inputs, outputs = type.outputs;
        let height = 0, width = 0;
        if (name) {
            width = 2 * spacing + ctx.measureText(name).width;
            height += textSize + spacing / 2;
        }
        else {
            height += spacing / 2;
        }
        function layoutPins(pins) {
            let y = height, w = 0;
            for (let i = 0; i < pins.length; i++) {
                let pin = pins[i];
                self.layoutPin(pin);
                pin.y = y + spacing / 2;
                let name = pin.name, pw = pin.width, ph = pin.height + spacing / 2;
                if (name) {
                    pin.baseline = y + textSize;
                    if (textSize > ph) {
                        pin.y += (textSize - ph) / 2;
                        ph = textSize;
                    }
                    else {
                        pin.baseline += (ph - textSize) / 2;
                    }
                    pw += 2 * spacing + ctx.measureText(name).width;
                }
                y += ph;
                w = Math.max(w, pw);
            }
            return [y, w];
        }
        const [yIn, wIn] = layoutPins(inputs);
        const [yOut, wOut] = layoutPins(outputs);
        type.width = Math.round(Math.max(width, wIn + 2 * spacing + wOut, theme.minTypeWidth));
        type.height = Math.round(Math.max(yIn, yOut, theme.minTypeHeight) + spacing / 2);
    }
    layoutPin(pin) {
        const type = pin.type;
        if (type.needsLayout)
            this.layoutType(type);
        pin.width = type.width;
        pin.height = type.height;
    }
    layoutElement(element) {
        const type = element.type;
        if (type.needsLayout)
            this.layoutType(type);
    }
    layoutWire(wire) {
        let src = wire.src, dst = wire.dst, p1 = wire.pSrc, p2 = wire.pDst;
        // Since we intercept change events and not transactions, wires may be in
        // an inconsistent state, so check before creating the path.
        if (src && wire.srcPin >= 0) {
            p1 = this.pinToPoint(src, wire.srcPin, false);
        }
        if (dst && wire.dstPin >= 0) {
            p2 = this.pinToPoint(dst, wire.dstPin, true);
        }
        if (p1 && p2) {
            wire.bezier = getEdgeBezier(p1, p2, 24);
        }
    }
    // Make sure a functionchart is big enough to enclose its contents.
    layoutFunctionchart(functionchart) {
        const self = this, spacing = this.theme.spacing;
        function layout(functionChart) {
            const nonWires = functionChart.nonWires;
            let width, height;
            if (nonWires.length === 0) {
                width = self.theme.minFunctionchartWidth;
                height = self.theme.minFunctionchartHeight;
            }
            else {
                const extents = self.getBounds(nonWires.asArray()), global = functionChart.globalPosition, x = global.x, y = global.y, margin = 2 * spacing, type = functionChart.type;
                width = extents.x + extents.width - x + margin;
                height = extents.y + extents.height - y + margin;
                if (type.needsLayout)
                    self.layoutType(type);
                width += type.width;
                height = Math.max(height, type.height + margin);
            }
            functionchart.width = Math.max(width, functionchart.width);
            functionchart.height = Math.max(height, functionchart.height);
        }
        // Visit in reverse order to correctly include sub-functionchart bounds.
        functionchart.context.reverseVisitAll(functionchart, item => {
            if (item instanceof Functionchart)
                layout(item);
        });
    }
    drawType(type, x, y, fillOutputs) {
        const self = this, ctx = this.ctx, theme = this.theme, textSize = theme.fontSize, spacing = theme.spacing, name = type.name, w = type.width, h = type.height, right = x + w;
        ctx.lineWidth = 0.5;
        ctx.fillStyle = theme.textColor;
        ctx.textBaseline = 'bottom';
        if (name) {
            ctx.textAlign = 'center';
            ctx.fillText(name, x + w / 2, y + textSize + spacing / 2);
        }
        type.inputs.forEach(function (pin, i) {
            const name = pin.name;
            self.drawPin(pin, x, y + pin.y, false);
            if (name) {
                ctx.textAlign = 'left';
                ctx.fillText(name, x + pin.width + spacing, y + pin.baseline);
            }
        });
        type.outputs.forEach(function (pin) {
            const name = pin.name, pinLeft = right - pin.width;
            self.drawPin(pin, pinLeft, y + pin.y, fillOutputs);
            if (name) {
                ctx.textAlign = 'right';
                ctx.fillText(name, pinLeft - spacing, y + pin.baseline);
            }
        });
    }
    drawPin(pin, x, y, fill) {
        const ctx = this.ctx, theme = this.theme;
        ctx.strokeStyle = theme.strokeColor;
        if (pin.typeString === 'v' || pin.typeString === '*') {
            const r = theme.knobbyRadius;
            ctx.beginPath();
            if (pin.typeString === 'v') {
                const d = 2 * r;
                ctx.rect(x, y, d, d);
            }
            else {
                ctx.arc(x + r, y + r, r, 0, Math.PI * 2, true);
            }
            ctx.stroke();
        }
        else if (pin.type) {
            const type = pin.type, width = type.width, height = type.height;
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            // if (level == 1) {
            //   ctx.fillStyle = theme.altBgColor;
            //   ctx.fill();
            // }
            ctx.stroke();
            this.drawType(type, x, y, false);
        }
    }
    drawElement(element, mode) {
        const ctx = this.ctx, theme = this.theme, spacing = theme.spacing, rect = this.getItemRect(element), x = rect.x, y = rect.y, w = rect.width, h = rect.height, right = x + w, bottom = y + h;
        if (element instanceof Pseudoelement) {
            switch (element.template.typeName) {
                case 'input':
                    inFlagPath(x, y, w, h, spacing, ctx);
                    break;
                case 'output':
                    outFlagPath(x, y, w, h, spacing, ctx);
                    break;
                case 'literal':
                    ctx.beginPath();
                    ctx.rect(x, y, w, h);
                    break;
            }
        }
        else {
            ctx.beginPath();
            ctx.rect(x, y, w, h);
        }
        switch (mode) {
            case RenderMode.Normal:
            case RenderMode.Print:
                ctx.fillStyle = /*element.state === 'palette' ? theme.altBgColor :*/ theme.bgColor;
                ctx.fill();
                ctx.strokeStyle = theme.strokeColor;
                ctx.lineWidth = 0.5;
                ctx.stroke();
                this.drawType(element.type, x, y, false);
                break;
            case RenderMode.Highlight:
                ctx.strokeStyle = theme.highlightColor;
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
            case RenderMode.HotTrack:
                ctx.strokeStyle = theme.hotTrackColor;
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
        }
    }
    drawElementPin(element, input, output, mode) {
        const theme = this.theme, ctx = this.ctx, rect = this.getItemRect(element), type = element.type;
        let x = rect.x, y = rect.y, w = rect.width, h = rect.height, right = x + w, pin;
        if (input >= 0) {
            pin = type.inputs[input];
        }
        else if (output >= 0) {
            pin = type.outputs[output];
            x = right - pin.width;
        }
        ctx.beginPath();
        ctx.rect(x, y + pin.y, pin.width, pin.height);
        switch (mode) {
            case RenderMode.Normal:
            case RenderMode.Print:
                ctx.strokeStyle = theme.strokeColor;
                ctx.lineWidth = 1;
                break;
            case RenderMode.Highlight:
                ctx.strokeStyle = theme.highlightColor;
                ctx.lineWidth = 2;
                break;
            case RenderMode.HotTrack:
                ctx.strokeStyle = theme.hotTrackColor;
                ctx.lineWidth = 2;
                break;
        }
        ctx.stroke();
    }
    drawFunctionchart(functionchart, mode) {
        const ctx = this.ctx, theme = this.theme, r = theme.radius, rect = this.getItemRect(functionchart), x = rect.x, y = rect.y, w = rect.width, h = rect.height, textSize = theme.fontSize, lineBase = y + textSize + theme.textLeading;
        roundRectPath(x, y, w, h, r, ctx);
        switch (mode) {
            case RenderMode.Normal:
            case RenderMode.Print:
                ctx.fillStyle = theme.bgColor;
                ctx.fill();
                ctx.strokeStyle = theme.strokeColor;
                ctx.lineWidth = 0.5;
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x, lineBase);
                ctx.lineTo(x + w, lineBase);
                ctx.stroke();
                const type = functionchart.type, instanceRect = this.getFunctionchartInstanceBounds(type, rect);
                ctx.beginPath();
                ctx.rect(instanceRect.x, instanceRect.y, instanceRect.width, instanceRect.height);
                ctx.fillStyle = theme.altBgColor;
                ctx.fill();
                ctx.strokeStyle = theme.strokeColor;
                ctx.lineWidth = 0.5;
                ctx.stroke();
                this.drawType(type, instanceRect.x, instanceRect.y, false);
                break;
            case RenderMode.Highlight:
            case RenderMode.HotTrack:
                roundRectPath(x, y, w, h, r, ctx);
                ctx.strokeStyle = mode === RenderMode.Highlight ? theme.highlightColor : theme.hotTrackColor;
                ctx.lineWidth = 2;
                ctx.stroke();
                break;
        }
    }
    hitTestElement(element, p, tol, mode) {
        const rect = this.getItemRect(element), x = rect.x, y = rect.y, width = rect.width, height = rect.height, hitInfo = hitTestRect(x, y, width, height, p, tol);
        if (hitInfo) {
            const result = new ElementHitResult(element, hitInfo), type = element.type;
            type.inputs.forEach(function (input, i) {
                if (hitTestRect(x, y + input.y, input.width, input.height, p, 0)) {
                    result.input = i;
                }
            });
            type.outputs.forEach(function (output, i) {
                if (hitTestRect(x + width - output.width, y + output.y, output.width, output.height, p, 0)) {
                    result.output = i;
                }
            });
            return result;
        }
    }
    hitTestFunctionchart(functionchart, p, tol, mode) {
        const theme = this.theme, r = theme.radius, rect = this.getItemRect(functionchart), x = rect.x, y = rect.y, w = rect.width, h = rect.height, inner = hitTestRect(x, y, w, h, p, tol);
        if (inner) {
            const instanceRect = this.getFunctionchartInstanceBounds(functionchart.type, rect), instancer = hitTestRect(instanceRect.x, instanceRect.y, instanceRect.width, instanceRect.height, p, tol) !== undefined;
            return new FunctionchartHitResult(functionchart, inner, instancer);
        }
    }
    drawWire(wire, mode) {
        const theme = this.theme, ctx = this.ctx;
        bezierEdgePath(wire.bezier, ctx, 0);
        switch (mode) {
            case RenderMode.Normal:
            case RenderMode.Print:
                ctx.strokeStyle = theme.strokeColor;
                ctx.lineWidth = 1;
                break;
            case RenderMode.Highlight:
                ctx.strokeStyle = theme.highlightColor;
                ctx.lineWidth = 2;
                break;
            case RenderMode.HotTrack:
                ctx.strokeStyle = theme.hotTrackColor;
                ctx.lineWidth = 2;
                break;
        }
        ctx.stroke();
    }
    hitTestWire(wire, p, tol, mode) {
        // TODO don't hit test new wire as it's dragged!
        const hitInfo = hitTestBezier(wire.bezier, p, tol);
        if (hitInfo) {
            return new WireHitResult(wire, hitInfo);
        }
    }
    draw(item, mode) {
        if (item instanceof ElementBase) {
            this.drawElement(item, mode);
        }
        else if (item instanceof Wire) {
            this.drawWire(item, mode);
        }
        else if (item instanceof Functionchart) {
            this.drawFunctionchart(item, mode);
        }
    }
    hitTest(item, p, tol, mode) {
        let hitInfo;
        if (item instanceof ElementBase) {
            hitInfo = this.hitTestElement(item, p, tol, mode);
        }
        else if (item instanceof Wire) {
            hitInfo = this.hitTestWire(item, p, tol, mode);
        }
        else if (item instanceof Functionchart) {
            hitInfo = this.hitTestFunctionchart(item, p, tol, mode);
        }
        return hitInfo;
    }
    layout(item) {
        if (item instanceof ElementBase) {
            this.layoutElement(item);
        }
        else if (item instanceof Wire) {
            this.layoutWire(item);
        }
        else if (item instanceof Functionchart) {
            this.layoutFunctionchart(item);
        }
    }
    drawHoverText(item, p, nameValuePairs) {
        const self = this, ctx = this.ctx, theme = this.theme, textSize = theme.fontSize, gap = 16, border = 4, height = textSize * nameValuePairs.length + 2 * border, maxWidth = measureNameValuePairs(nameValuePairs, gap, ctx) + 2 * border;
        let x = p.x, y = p.y;
        ctx.fillStyle = theme.hoverColor;
        ctx.fillRect(x, y, maxWidth, height);
        ctx.fillStyle = theme.hoverTextColor;
        nameValuePairs.forEach(function (pair) {
            ctx.textAlign = 'left';
            ctx.fillText(pair.name, x + border, y + textSize);
            ctx.textAlign = 'right';
            ctx.fillText(pair.value, x + maxWidth - border, y + textSize);
            y += textSize;
        });
    }
}
// --------------------------------------------------------------------------------------------
function isDropTarget(hitInfo) {
    const item = hitInfo.item, selection = item.context.selection;
    return (hitInfo instanceof FunctionchartHitResult || hitInfo instanceof ElementHitResult) &&
        !selection.has(item) && !ancestorInSet(item, selection);
}
function isClickable(hitInfo) {
    return true;
}
function isDraggable(hitInfo) {
    return !(hitInfo instanceof Wire);
}
function isElementInputPin(hitInfo) {
    return hitInfo instanceof ElementHitResult && hitInfo.input >= 0;
}
function isElementOutputPin(hitInfo) {
    return hitInfo instanceof ElementHitResult && hitInfo.output >= 0;
}
function hasProperties(hitInfo) {
    return !(hitInfo instanceof Wire);
}
class NonWireDrag {
    constructor(items, type, description) {
        this.items = items;
        this.type = type;
        this.description = description;
    }
}
class WireDrag {
    constructor(transition, type, description) {
        this.wire = transition;
        this.type = type;
        this.description = description;
    }
}
export class FunctionchartEditor {
    constructor(theme, canvasController, paletteController, propertyGridController) {
        this.scrap = [];
        this.clickInPalette = false;
        this.propertyInfo = new Map();
        const self = this;
        this.theme = new FunctionchartTheme(theme);
        this.canvasController = canvasController;
        this.paletteController = paletteController;
        this.propertyGridController = propertyGridController;
        this.fileController = new FileController();
        this.hitTolerance = 8;
        // Change tracking for layout.
        // Changed items that must be updated before drawing and hit testing.
        this.changedItems = new Set();
        // Changed top level functioncharts that must be laid out after transactions and undo/redo.
        this.changedTopLevelFunctioncharts = new Set();
        const renderer = new Renderer(theme);
        this.renderer = renderer;
        // Embed the palette items in a Functionchart so the renderer can do layout and drawing.
        const context = new FunctionchartContext(), functionchart = context.newFunctionchart(), input = context.newPseudoelement('input'), output = context.newPseudoelement('output'), literal = context.newPseudoelement('literal'), newBinop = context.newElement('binop'), newUnop = context.newElement('unop'), newCond = context.newElement('cond'), newFunctionchart = context.newFunctionchart();
        context.root = functionchart;
        literal.x = 8;
        literal.y = 8;
        input.x = 40;
        input.y = 8;
        output.x = 72;
        output.y = 8;
        newBinop.x = 8;
        newBinop.y = 32;
        newBinop.typeString = '[vv,v](+)'; // binary addition
        newUnop.x = 48;
        newUnop.y = 32;
        newUnop.typeString = '[v,v](-)'; // unary negation
        newCond.x = 86;
        newCond.y = 32; // conditional
        newFunctionchart.x = 8;
        newFunctionchart.y = 82;
        newFunctionchart.width = this.theme.minFunctionchartWidth;
        newFunctionchart.height = this.theme.minFunctionchartHeight;
        functionchart.nonWires.append(literal);
        functionchart.nonWires.append(input);
        functionchart.nonWires.append(output);
        functionchart.nonWires.append(newBinop);
        functionchart.nonWires.append(newUnop);
        functionchart.nonWires.append(newCond);
        functionchart.nonWires.append(newFunctionchart);
        context.root = functionchart;
        this.palette = functionchart;
        // Default Functionchart.
        this.context = new FunctionchartContext();
        this.initializeContext(this.context);
        this.functionchart = this.context.root;
        // Register property grid layouts.
        function getter(info, item) {
            return item ? info.prop.get(item) : '';
        }
        function setter(info, item, value) {
            if (item && (info.prop instanceof ScalarProp || info.prop instanceof ReferenceProp)) {
                const description = 'change ' + info.label, transactionManager = self.context.transactionManager;
                transactionManager.beginTransaction(description);
                info.prop.set(item, value);
                transactionManager.endTransaction();
                self.canvasController.draw();
            }
        }
        function elementLabelGetter(info, item) {
            switch (item.template.typeName) {
                case 'input': // [,v(label)]
                    return item.type.outputs[0].name || '';
                case 'output': // [v(label),]
                    return item.type.inputs[0].name || '';
                case 'literal': // [,v(label)]
                    return item.type.outputs[0].name || '';
                case 'binop': // [vv,v](label)
                case 'unop': // [v,v](label)
                case 'functionchart': // [...](label)
                    return item.type.name || '';
            }
            return '';
        }
        function elementLabelSetter(info, item, value) {
            const typeString = getter(info, item);
            let newValue;
            if (value === undefined) {
                newValue = globalTypeParser_.getUnlabeledTypeString(typeString);
            }
            else {
                switch (item.template.typeName) {
                    case 'input': // [,v(label)]
                        newValue = '[,*(' + value + ')]';
                        break;
                    case 'output': // [v(label),]
                        newValue = '[*(' + value + '),]';
                        break;
                    case 'literal': // [,v(label)]
                        newValue = '[,v(' + value + ')]';
                        break;
                    case 'binop': // [vv,v](label)
                        newValue = globalTypeParser_.addLabel(typeString, value);
                        break;
                    case 'unop': // [v,v](label)
                        newValue = globalTypeParser_.addLabel(typeString, value);
                        break;
                    case 'functionchart': // [...](label)
                        newValue = globalTypeParser_.addLabel(typeString, value);
                        break;
                }
            }
            setter(info, item, newValue);
        }
        this.propertyInfo.set('input', [
            {
                label: 'label',
                type: 'text',
                getter: elementLabelGetter,
                setter: elementLabelSetter,
                prop: typeStringProp,
            }
        ]);
        this.propertyInfo.set('output', [
            {
                label: 'label',
                type: 'text',
                getter: elementLabelGetter,
                setter: elementLabelSetter,
                prop: typeStringProp,
            }
        ]);
        this.propertyInfo.set('literal', [
            {
                label: 'value',
                type: 'text',
                getter: elementLabelGetter,
                setter: elementLabelSetter,
                prop: typeStringProp,
            }
        ]);
        const binaryOps = ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=',
            '|', '&', '||', '&&'];
        this.propertyInfo.set('binop', [
            {
                label: 'operator',
                type: 'enum',
                values: binaryOps.join(','),
                getter: elementLabelGetter,
                setter: elementLabelSetter,
                prop: typeStringProp,
            },
        ]);
        const unaryOps = ['!', '~', '-'];
        this.propertyInfo.set('unop', [
            {
                label: 'operator',
                type: 'enum',
                values: unaryOps.join(','),
                getter: elementLabelGetter,
                setter: elementLabelSetter,
                prop: typeStringProp,
            },
        ]);
        this.propertyInfo.set('functionchart', [
            {
                label: 'name',
                type: 'text',
                getter: elementLabelGetter,
                setter: elementLabelSetter,
                prop: typeStringProp,
            },
        ]);
        this.propertyInfo.forEach((info, key) => {
            propertyGridController.register(key, info);
        });
    }
    initializeContext(context) {
        const self = this;
        // On attribute changes and item insertions, dynamically layout affected items.
        // This allows us to layout transitions as their src or dst elements are dragged.
        context.addHandler('changed', change => self.onChanged(change));
        // On ending transactions and undo/redo, layout the changed top level functioncharts.
        function update() {
            self.updateBounds();
        }
        context.transactionManager.addHandler('transactionEnding', update);
        context.transactionManager.addHandler('didUndo', update);
        context.transactionManager.addHandler('didRedo', update);
    }
    setContext(context) {
        const functionchart = context.root, renderer = this.renderer;
        this.context = context;
        this.functionchart = functionchart;
        this.changedItems.clear();
        this.changedTopLevelFunctioncharts.clear();
        // renderer.setModel(model);
        // Layout any items in the functionchart.
        renderer.begin(this.canvasController.getCtx());
        context.reverseVisitAll(this.functionchart, item => renderer.layout(item));
        renderer.end();
    }
    initialize(canvasController) {
        if (canvasController === this.canvasController) {
        }
        else {
            const renderer = this.renderer;
            renderer.begin(canvasController.getCtx());
            // Layout the palette items and their parent functionchart.
            renderer.begin(canvasController.getCtx());
            this.context.reverseVisitAll(this.palette, item => renderer.layout(item));
            // Draw the palette items.
            this.palette.nonWires.forEach(item => renderer.draw(item, RenderMode.Print));
            renderer.end();
        }
    }
    onChanged(change) {
        const functionchart = this.functionchart, context = this.context, changedItems = this.changedItems, changedTopLevelStates = this.changedTopLevelFunctioncharts, item = change.item, prop = change.prop;
        // Track all top level functioncharts which contain changes. On ending a transaction,
        // update the layout of functioncharts.
        let ancestor = item, topLevel;
        do {
            topLevel = ancestor;
            ancestor = ancestor.parent;
        } while (ancestor && ancestor !== functionchart);
        if (ancestor === functionchart && topLevel instanceof Functionchart) {
            changedTopLevelStates.add(topLevel);
        }
        function addItems(item) {
            if (item instanceof ElementBase) {
                // Layout the state's incoming and outgoing transitions.
                context.forInWires(item, addItems);
                context.forOutWires(item, addItems);
            }
            changedItems.add(item);
        }
        switch (change.type) {
            case 'valueChanged': {
                // For changes to x, y, width, height, or typeString, layout affected transitions.
                if (prop === xProp || prop === yProp || prop === widthProp || prop === heightProp ||
                    prop === typeStringProp) {
                    // Visit item and sub-items to layout all affected wires.
                    context.visitAll(item, addItems);
                }
                else if (item instanceof Wire) {
                    addItems(item);
                }
                break;
            }
            case 'elementInserted': {
                // Update item subtrees as they are inserted.
                context.reverseVisitAll(prop.get(item).at(change.index), addItems);
                break;
            }
        }
    }
    updateLayout() {
        const renderer = this.renderer, context = this.context, changedItems = this.changedItems;
        // This function is called during the draw, hitTest, and updateBounds_ methods,
        // so the renderer is started.
        // First layout containers, and then layout wires which depend on elements'
        // size and location.
        function layout(item, visitor) {
            context.reverseVisitAll(item, visitor);
        }
        // Layout elements. Functioncharts are updated at the end of the transaction.
        changedItems.forEach(item => {
            layout(item, item => {
                if (item instanceof ElementBase)
                    renderer.layout(item);
            });
        });
        changedItems.forEach(item => {
            layout(item, item => {
                if (item instanceof Wire)
                    renderer.layout(item);
            });
        });
        changedItems.clear();
    }
    updateBounds() {
        const ctx = this.canvasController.getCtx(), renderer = this.renderer, context = this.context, functionchart = this.functionchart, changedTopLevelStates = this.changedTopLevelFunctioncharts;
        renderer.begin(ctx);
        // Update any changed items first.
        this.updateLayout();
        // Then update the bounds of super states, bottom up.
        changedTopLevelStates.forEach(state => context.reverseVisitAll(state, item => {
            if (!(item instanceof Wire))
                renderer.layout(item);
        }));
        // Finally update the root functionchart's bounds.
        renderer.layoutFunctionchart(functionchart);
        renderer.end();
        changedTopLevelStates.clear();
        // Make sure the canvas is large enough to contain the root functionchart.
        const canvasController = this.canvasController, canvasSize = canvasController.getSize();
        let width = functionchart.width, height = functionchart.height;
        if (width > canvasSize.width || height > canvasSize.height) {
            width = Math.max(width, canvasSize.width);
            height = Math.max(height, canvasSize.height);
            canvasController.setSize(width, height);
        }
    }
    draw(canvasController) {
        const renderer = this.renderer, functionchart = this.functionchart, context = this.context;
        if (canvasController === this.canvasController) {
            // Draw a dashed border around the canvas.
            const ctx = canvasController.getCtx(), size = canvasController.getSize();
            ctx.strokeStyle = this.theme.strokeColor;
            ctx.lineWidth = 0.5;
            ctx.setLineDash([6, 3]);
            ctx.strokeRect(0, 0, size.width, size.height);
            ctx.setLineDash([]);
            // Now draw the functionchart.
            renderer.begin(ctx);
            this.updateLayout();
            canvasController.applyTransform();
            // Don't draw the root functionchart.
            functionchart.nonWires.forEach(item => {
                context.visitNonWires(item, item => { renderer.draw(item, RenderMode.Normal); });
            });
            // Draw wires after elements.
            context.visitWires(functionchart, wire => {
                renderer.drawWire(wire, RenderMode.Normal);
            });
            // Highlight selection.
            context.selection.forEach(function (item) {
                renderer.draw(item, RenderMode.Highlight);
            });
            if (this.hotTrackInfo)
                renderer.draw(this.hotTrackInfo.item, RenderMode.HotTrack);
            const hoverHitInfo = this.hoverHitInfo;
            if (hoverHitInfo) {
                const item = hoverHitInfo.item, propertyInfo = this.propertyInfo.get(item.template.typeName), nameValuePairs = [];
                if (propertyInfo) {
                    for (let info of propertyInfo) {
                        const name = info.label, value = info.getter(info, item);
                        if (value !== undefined) {
                            nameValuePairs.push({ name, value });
                        }
                    }
                    renderer.drawHoverText(hoverHitInfo.item, this.hoverPoint, nameValuePairs);
                }
            }
            renderer.end();
        }
        else if (canvasController === this.paletteController) {
            // Palette drawing occurs during drag and drop. If the palette has the drag,
            // draw the canvas underneath so the new object will appear on the canvas.
            this.canvasController.draw();
            const ctx = this.paletteController.getCtx();
            renderer.begin(ctx);
            canvasController.applyTransform();
            this.palette.nonWires.forEach(item => { renderer.draw(item, RenderMode.Print); });
            // Draw any selected object in the palette. Translate object to palette coordinates.
            const offset = canvasController.offsetToOtherCanvas(this.canvasController);
            ctx.translate(offset.x, offset.y);
            context.selection.forEach(item => {
                renderer.draw(item, RenderMode.Normal);
                renderer.draw(item, RenderMode.Highlight);
            });
            renderer.end();
        }
    }
    print() {
        const renderer = this.renderer, context = this.context, functionchart = this.functionchart, canvasController = this.canvasController;
        // Calculate document bounds.
        const items = new Array();
        context.visitAll(functionchart, function (item) {
            items.push(item);
        });
        const bounds = renderer.getBounds(items);
        // Adjust all edges 1 pixel out.
        const ctx = new window.C2S(bounds.width + 2, bounds.height + 2);
        ctx.translate(-bounds.x + 1, -bounds.y + 1);
        renderer.begin(ctx);
        canvasController.applyTransform();
        // Don't draw the root functionchart.
        functionchart.nonWires.forEach(item => {
            context.visitNonWires(item, item => { renderer.draw(item, RenderMode.Print); });
        });
        // Draw wires after elements.
        context.visitWires(functionchart, wire => {
            renderer.drawWire(wire, RenderMode.Print);
        });
        renderer.end();
        // Write out the SVG file.
        const serializedSVG = ctx.getSerializedSvg();
        const blob = new Blob([serializedSVG], {
            type: 'text/plain'
        });
        window.saveAs(blob, 'functionchart.svg', true);
    }
    getCanvasPosition(canvasController, p) {
        // When dragging from the palette, convert the position from pointer events
        // into the canvas space to render the drag and drop.
        return this.canvasController.viewToOtherCanvasView(canvasController, p);
    }
    hitTestCanvas(p) {
        const renderer = this.renderer, context = this.context, tol = this.hitTolerance, functionchart = this.functionchart, canvasController = this.canvasController, cp = this.getCanvasPosition(canvasController, p), ctx = canvasController.getCtx(), hitList = [];
        function pushInfo(info) {
            if (info)
                hitList.push(info);
        }
        renderer.begin(ctx);
        this.updateLayout();
        // TODO hit test selection first, in highlight, first.
        // Hit test transitions first.
        context.reverseVisitWires(functionchart, (wire) => {
            pushInfo(renderer.hitTestWire(wire, cp, tol, RenderMode.Normal));
        });
        // Skip the root functionchart, as hits there should go to the underlying canvas controller.
        functionchart.nonWires.forEachReverse(item => {
            context.reverseVisitNonWires(item, (item) => {
                pushInfo(renderer.hitTest(item, cp, tol, RenderMode.Normal));
            });
        });
        renderer.end();
        return hitList;
    }
    hitTestPalette(p) {
        const renderer = this.renderer, context = this.context, tol = this.hitTolerance, ctx = this.paletteController.getCtx(), hitList = [];
        function pushInfo(info) {
            if (info)
                hitList.push(info);
        }
        renderer.begin(ctx);
        this.palette.nonWires.forEachReverse(item => {
            pushInfo(renderer.hitTest(item, p, tol, RenderMode.Normal));
        });
        renderer.end();
        return hitList;
    }
    getFirstHit(hitList, filterFn) {
        for (let hitInfo of hitList) {
            if (filterFn(hitInfo))
                return hitInfo;
        }
    }
    getDraggableAncestor(hitList, hitInfo) {
        while (hitInfo && !isDraggable(hitInfo)) {
            const parent = hitInfo.item.parent;
            hitInfo = this.getFirstHit(hitList, info => { return info.item === parent; });
        }
        return hitInfo;
    }
    setPropertyGrid() {
        const context = this.context, item = context.selection.lastSelected(), type = item ? item.template.typeName : undefined;
        this.propertyGridController.show(type, item);
    }
    onClick(canvasController) {
        const context = this.context, selection = context.selection, shiftKeyDown = this.canvasController.shiftKeyDown, cmdKeyDown = this.canvasController.cmdKeyDown, p = canvasController.getClickPointerPosition(), cp = canvasController.viewToCanvas(p);
        let hitList;
        if (canvasController === this.paletteController) {
            hitList = this.hitTestPalette(cp);
            this.clickInPalette = true;
        }
        else {
            hitList = this.hitTestCanvas(cp);
            this.clickInPalette = false;
        }
        const pointerHitInfo = this.pointerHitInfo = this.getFirstHit(hitList, isClickable);
        if (pointerHitInfo) {
            this.draggableHitInfo = this.getDraggableAncestor(hitList, pointerHitInfo);
            const item = pointerHitInfo.item;
            if (this.clickInPalette) {
                selection.clear();
            }
            else if (cmdKeyDown) {
                selection.toggle(item);
            }
            else if (shiftKeyDown) {
                selection.add(item);
            }
            else if (!selection.has(item)) {
                selection.set(item);
            }
            else {
                selection.add(item);
            }
        }
        else {
            if (!shiftKeyDown) {
                selection.clear();
            }
        }
        this.setPropertyGrid();
        return pointerHitInfo !== undefined;
    }
    onBeginDrag(canvasController) {
        let pointerHitInfo = this.pointerHitInfo;
        if (!pointerHitInfo)
            return false;
        const context = this.context, selection = context.selection, p0 = canvasController.getClickPointerPosition();
        let dragItem = pointerHitInfo.item;
        let drag, newWire;
        // First check for a drag that creates a new wire.
        if ((pointerHitInfo instanceof ElementHitResult &&
            (pointerHitInfo.input >= 0 || pointerHitInfo.output >= 0))) {
            const element = dragItem, cp0 = this.getCanvasPosition(canvasController, p0);
            if (pointerHitInfo.input >= 0) {
                newWire = context.newWire(undefined, -1, element, pointerHitInfo.input);
                newWire.pSrc = { x: cp0.x, y: cp0.y, nx: 0, ny: 0 };
                drag = new WireDrag(newWire, 'connectWireSrc', 'Add new wire');
            }
            else if (pointerHitInfo.output >= 0) {
                newWire = context.newWire(element, pointerHitInfo.output, undefined, -1);
                newWire.pDst = { x: cp0.x, y: cp0.y, nx: 0, ny: 0 };
                drag = new WireDrag(newWire, 'connectWireDst', 'Add new wire');
            }
        }
        else if (pointerHitInfo instanceof WireHitResult) {
            if (pointerHitInfo.inner.t === 0) {
                drag = new WireDrag(dragItem, 'connectWireSrc', 'Edit wire');
            }
            else if (pointerHitInfo.inner.t === 1) {
                drag = new WireDrag(dragItem, 'connectWireDst', 'Edit wire');
            }
        }
        else if (this.draggableHitInfo) {
            pointerHitInfo = this.pointerHitInfo = this.draggableHitInfo;
            if (!(pointerHitInfo instanceof WireHitResult)) {
                if (this.clickInPalette) {
                    drag = new NonWireDrag([pointerHitInfo.item], 'copyPalette', 'Create new element or functionchart');
                }
                else if (this.canvasController.shiftKeyDown) {
                    drag = new NonWireDrag(context.selectedAllElements(), 'moveCopySelection', 'Move copy of selection');
                }
                else {
                    if (pointerHitInfo instanceof FunctionchartHitResult) {
                        if (pointerHitInfo.inner.border) {
                            drag = new NonWireDrag([pointerHitInfo.item], 'resizeFunctionchart', 'Resize functionchart');
                        }
                        else if (pointerHitInfo.instancer) {
                            drag = new NonWireDrag([pointerHitInfo.item], 'instantiateFunctionchart', 'Create new instance of functionchart');
                        }
                        else {
                            drag = new NonWireDrag(context.selectedAllElements(), 'moveSelection', 'Move selection');
                        }
                    }
                    else {
                        drag = new NonWireDrag(context.selectedAllElements(), 'moveSelection', 'Move selection');
                    }
                }
            }
        }
        this.dragInfo = drag;
        if (drag) {
            if (drag.type === 'moveSelection' || drag.type === 'moveCopySelection') {
                context.reduceSelection();
            }
            if (drag.type == 'copyPalette') {
                // Transform palette items into the canvas coordinate system.
                const offset = this.paletteController.offsetToOtherCanvas(this.canvasController), copies = copyItems(drag.items, context);
                copies.forEach(copy => {
                    if (!(copy instanceof Wire)) {
                        copy.x -= offset.x;
                        copy.y -= offset.y;
                    }
                });
                drag.items = copies;
            }
            else if (drag.type == 'moveCopySelection') {
                const copies = context.copy(); // TODO fix
                drag.items = copies;
            }
            else if (drag.type === 'instantiateFunctionchart') {
                const functionchart = drag.items[0], newInstance = context.newFunctionInstance(), renderer = this.renderer, bounds = renderer.getItemRect(functionchart), instancerBounds = this.renderer.getFunctionchartInstanceBounds(functionchart.type, bounds); // TODO simplify this
                newInstance.functionchart = functionchart;
                newInstance.type = functionchart.type; // TODO shouldn't have to manually set this.
                newInstance.x = instancerBounds.x;
                newInstance.y = instancerBounds.y;
                drag.items = [newInstance];
            }
            context.transactionManager.beginTransaction(drag.description);
            if (newWire) {
                context.addItem(newWire, this.functionchart);
                selection.set(newWire);
            }
            else {
                if (drag.type == 'copyPalette' || drag.type == 'moveCopySelection' ||
                    drag.type === 'instantiateFunctionchart') {
                    context.addItems(drag.items, this.functionchart);
                    selection.set(drag.items);
                }
            }
        }
    }
    onDrag(canvasController) {
        const drag = this.dragInfo;
        if (!drag)
            return;
        const context = this.context, transactionManager = context.transactionManager, renderer = this.renderer, p0 = canvasController.getClickPointerPosition(), cp0 = this.getCanvasPosition(canvasController, p0), p = canvasController.getCurrentPointerPosition(), cp = this.getCanvasPosition(canvasController, p), dx = cp.x - cp0.x, dy = cp.y - cp0.y, pointerHitInfo = this.pointerHitInfo, hitList = this.hitTestCanvas(cp);
        let hitInfo;
        if (drag instanceof NonWireDrag) {
            switch (drag.type) {
                case 'copyPalette':
                case 'moveCopySelection':
                case 'moveSelection':
                case 'instantiateFunctionchart': {
                    hitInfo = this.getFirstHit(hitList, isDropTarget);
                    context.selection.forEach(item => {
                        if (item instanceof Wire)
                            return;
                        const oldX = transactionManager.getOldValue(item, 'x'), oldY = transactionManager.getOldValue(item, 'y');
                        item.x = oldX + dx;
                        item.y = oldY + dy;
                    });
                    break;
                }
                case 'resizeFunctionchart': {
                    const hitInfo = pointerHitInfo, item = drag.items[0], oldX = transactionManager.getOldValue(item, 'x'), oldY = transactionManager.getOldValue(item, 'y'), oldWidth = transactionManager.getOldValue(item, 'width'), oldHeight = transactionManager.getOldValue(item, 'height');
                    if (hitInfo.inner.left) {
                        item.x = oldX + dx;
                        item.width = oldWidth - dx;
                    }
                    if (hitInfo.inner.top) {
                        item.y = oldY + dy;
                        item.height = oldHeight - dy;
                    }
                    if (hitInfo.inner.right)
                        item.width = oldWidth + dx;
                    if (hitInfo.inner.bottom)
                        item.height = oldHeight + dy;
                    break;
                }
            }
        }
        else if (drag instanceof WireDrag) {
            const wire = drag.wire;
            switch (drag.type) {
                case 'connectWireSrc': {
                    const dst = wire.dst, dstPin = wire.dstPin, hitInfo = this.getFirstHit(hitList, isElementOutputPin), src = hitInfo ? hitInfo.item : undefined;
                    if (src && dst && src !== dst) {
                        wire.src = src;
                        wire.srcPin = hitInfo.output;
                    }
                    else {
                        wire.src = undefined; // This notifies observers to update the layout.
                        wire.pSrc = { x: cp.x, y: cp.y, nx: 0, ny: 0 };
                    }
                    break;
                }
                case 'connectWireDst': {
                    const src = wire.src, hitInfo = this.getFirstHit(hitList, isElementInputPin), dst = hitInfo ? hitInfo.item : undefined;
                    if (src && dst && src !== dst) {
                        wire.dst = dst;
                        wire.dstPin = hitInfo.input;
                    }
                    else {
                        wire.dst = undefined; // This notifies observers to update the layout.
                        wire.pDst = { x: cp.x, y: cp.y, nx: 0, ny: 0 };
                    }
                    break;
                }
            }
        }
        this.hotTrackInfo = (hitInfo && hitInfo.item !== this.functionchart) ? hitInfo : undefined;
    }
    onEndDrag(canvasController) {
        const drag = this.dragInfo;
        if (!drag)
            return;
        const context = this.context, functionchart = this.functionchart, selection = context.selection, transactionManager = context.transactionManager, p = canvasController.getCurrentPointerPosition(), cp = this.getCanvasPosition(canvasController, p);
        if (drag instanceof WireDrag) {
            drag.wire.pSrc = drag.wire.pDst = undefined;
        }
        else if (drag instanceof NonWireDrag &&
            (drag.type == 'copyPalette' || drag.type === 'moveSelection' ||
                drag.type === 'moveCopySelection' || drag.type === 'instantiateFunctionchart')) {
            // Find element or functionchart beneath mouse.
            const hitList = this.hitTestCanvas(cp), hitInfo = this.getFirstHit(hitList, isDropTarget);
            if (hitInfo instanceof ElementHitResult && drag.items[0] instanceof ElementBase) {
                context.replaceElement(hitInfo.item, drag.items[0]);
            }
            else {
                let parent = functionchart;
                if (hitInfo instanceof FunctionchartHitResult) {
                    parent = hitInfo.item;
                }
                // Reparent items
                selection.contents().forEach(item => {
                    context.addItem(item, parent);
                });
            }
        }
        transactionManager.endTransaction();
        this.setPropertyGrid();
        this.dragInfo = undefined;
        this.pointerHitInfo = undefined;
        this.draggableHitInfo = undefined;
        this.hotTrackInfo = undefined;
        this.canvasController.draw();
    }
    onKeyDown(e) {
        const self = this, context = this.context, functionchart = this.functionchart, selection = context.selection, transactionManager = context.transactionManager, keyCode = e.keyCode, // TODO fix me.
        cmdKey = e.ctrlKey || e.metaKey, shiftKey = e.shiftKey;
        if (keyCode === 8) { // 'delete'
            context.deleteSelection();
            return true;
        }
        if (cmdKey) {
            switch (keyCode) {
                case 65: { // 'a'
                    functionchart.nonWires.forEach(function (v) {
                        context.selection.add(v);
                    });
                    self.canvasController.draw();
                    return true;
                }
                case 90: { // 'z'
                    if (context.getUndo()) {
                        context.undo();
                        self.canvasController.draw();
                    }
                    return true;
                }
                case 89: { // 'y'
                    if (context.getRedo()) {
                        context.redo();
                        self.canvasController.draw();
                    }
                    return true;
                }
                case 88: { // 'x'
                    this.scrap = context.cut();
                    self.canvasController.draw();
                    return true;
                }
                case 67: { // 'c'
                    this.scrap = context.copy();
                    return true;
                }
                case 86: { // 'v'
                    if (this.scrap.length > 0) {
                        context.paste(this.scrap);
                        this.updateBounds();
                        return true;
                    }
                    return false;
                }
                case 71: { // 'g'
                    context.selection.set(context.selectedNonWires());
                    context.selectInteriorWires();
                    context.reduceSelection();
                    context.beginTransaction('group items into functionchart');
                    const theme = this.theme, bounds = this.renderer.getBounds(context.selectedNonWires()), contents = context.selectionContents(), parent = getLowestCommonAncestor(...contents);
                    expandRect(bounds, theme.radius, theme.radius);
                    context.group(context.selectionContents(), parent, bounds);
                    context.endTransaction();
                }
                case 69: { // 'e'
                    context.selectConnectedElements(true);
                    self.canvasController.draw();
                    return true;
                }
                case 72: // 'h'
                    // editingModel.doTogglePalette();
                    // return true;
                    return false;
                case 74: { // 'j'
                    const renderer = this.renderer;
                    renderer.begin(this.canvasController.getCtx());
                    function inputToPoint(element, pin) {
                        return renderer.pinToPoint(element, pin, true);
                    }
                    ;
                    function outputToPoint(element, pin) {
                        return renderer.pinToPoint(element, pin, false);
                    }
                    ;
                    context.beginTransaction('complete elements');
                    context.completeElements(context.selectedElements(), inputToPoint, outputToPoint);
                    renderer.end();
                    context.endTransaction();
                    return true;
                }
                case 75: { // 'k'
                    context.beginTransaction('export elements');
                    context.exportElements(context.selectedElements());
                    context.endTransaction();
                    return true;
                }
                case 76: // 'l'
                    context.beginTransaction('open elements');
                    context.openElements(context.selectedElements());
                    context.endTransaction();
                    return true;
                case 78: { // ctrl 'n'   // Can't intercept cmd n.
                    const context = new FunctionchartContext();
                    self.initializeContext(context);
                    self.setContext(context);
                    self.renderer.begin(self.canvasController.getCtx());
                    self.updateBounds();
                    self.canvasController.draw();
                    return true;
                }
                case 79: { // 'o'
                    function parse(text) {
                        const raw = JSON.parse(text), context = new FunctionchartContext();
                        const functionchart = Deserialize(raw, context);
                        context.root = functionchart;
                        self.initializeContext(context);
                        self.setContext(context);
                        self.renderer.begin(self.canvasController.getCtx());
                        self.updateBounds();
                        self.canvasController.draw();
                    }
                    this.fileController.openFile().then(result => parse(result));
                    return true;
                }
                case 83: { // 's'
                    let text = JSON.stringify(Serialize(functionchart), undefined, 2);
                    this.fileController.saveUnnamedFile(text, 'functionchart.txt').then();
                    // console.log(text);
                    return true;
                }
                case 80: { // 'p'
                    this.print();
                    return true;
                }
            }
        }
        return false;
    }
    onKeyUp(e) {
        return false;
    }
    onBeginHover(canvasController) {
        const context = this.context, p = canvasController.getCurrentPointerPosition(), hitList = this.hitTestCanvas(p), hoverHitInfo = this.hoverHitInfo = this.getFirstHit(hitList, hasProperties);
        if (!hoverHitInfo)
            return false;
        const cp = canvasController.viewToCanvas(p);
        this.hoverPoint = cp;
        this.hoverHitInfo = hoverHitInfo;
        return true;
    }
    onEndHover(canvasController) {
        this.hoverHitInfo = undefined;
    }
}
/*


//------------------------------------------------------------------------------

const editingModel = (function() {
  const proto = {




    getGroupTypeInfo: function(items, group) {
      const self = this, model = this.model,
            dataModel = model.dataModel,
            functionChartModel = model.functionChartModel,
            graphInfo = model.functionChartModel.getSubgraphInfo(items),
            renderer = this.model.renderer,
            inputs = [], outputs = [],
            contextInputs = [];

      function makePin(item, type, y) {
        return { item: item, type: type, y: y }
      }

      function getInputType(input) {
        const srcPin = getType(input).outputs[0],
              srcType = self.getPinTypeWithName(srcPin),
              wires = functionChartModel.getOutputs(input)[0];
        if (!wires.length)
          return srcType;
        const label = srcType.substring(1);
        return self.findDstType(wires[0]) + label;
      }

      function getOutputType(output) {
        const dstPin = getType(output).inputs[0],
              dstType = self.getPinTypeWithName(dstPin),
              wire = functionChartModel.getInputs(output)[0];
        if (!wire)
          return dstType;
        const label = dstType.substring(1);
        return self.findSrcType(wire) + label;
      }

      // Add pins for inputs, outputs, and disconnected pins on elements.
      items.forEach(function(item, index) {
        if (isInput(item)) {
          const y = renderer.pinToPoint(item, 0, false).y,
                type = getInputType(item);
          if (globalTypeParser_.trimType(type) != '*')
            inputs.push(makePin(item, type, y));
        } else if (isOutput(item)) {
          const y = renderer.pinToPoint(item, 0, true).y,
                type = getOutputType(item);
          if (globalTypeParser_.trimType(type) != '*')
            outputs.push(makePin(item, type, y));
        } else if (isElement(item)) {
          // Recursive group instances aren't included in the signature.
          if (group && self.isInstanceOfGroup(item, group))
            return;
          const type = getType(item),
                inputWires = functionChartModel.getInputs(item),
                outputWires = functionChartModel.getOutputs(item);
          type.inputs.forEach(function(pin, i) {
            if (!inputWires[i]) {
              const y = renderer.pinToPoint(item, i, true).y;
              inputs.push(makePin(item, pin.type, y));
            }
          });
          type.outputs.forEach(function(pin, i) {
            if (outputWires[i].length == 0) {
              const y = renderer.pinToPoint(item, i, false).y;
              outputs.push(makePin(item, pin.type, y));
            }
          });
        }// else if (isGroup(item)) {
         // const y = renderer.getItemRect(item).y;
         // outputs.push(makePin(item, item.type, y));
        //}
      });

      // Incoming wires become part of the enclosing context type. Use the
      // output pin's y to order the pins.
      graphInfo.incomingWires.forEach(function(wire) {
        const src = self.getWireSrc(wire),
              srcPin = getType(src).outputs[wire.srcPin],
              y = renderer.pinToPoint(src, wire.srcPin, false).y;
        contextInputs.push(makePin(src, srcPin.type, y));
      });

      // Sort pins so we encounter them in increasing y-order. This lets us lay
      // out the group in an intuitively consistent way.
      function comparePins(pin1, pin2) {
        return pin1.y - pin2.y;
      }

      inputs.sort(comparePins);
      outputs.sort(comparePins);

      let typeString = '[';
      inputs.forEach(function(input, i) {
        typeString += input.type;
        input.item.index = i;
      });
      typeString += ',';
      outputs.forEach(function(output, i) {
        typeString += output.type;
        output.item.index = i;
      });
      typeString += ']';

      contextInputs.sort(comparePins);

      let contextTypeString = '[';
      contextInputs.forEach(function(input, i) {
        contextTypeString += input.type;
        input.item.index = i;
      });
      contextTypeString += ',]';  // no outputs

      const info = {
        type: typeString,
        contextType: contextTypeString,
      }

      // Compute group pass throughs.
      const passThroughs = new Set();
      graphInfo.interiorWires.forEach(function(wire) {
        let src = self.getWireSrc(wire),
            srcPin = getType(src).outputs[wire.srcPin];
        // Trace wires, starting at input junctions.
        if (!isInput(src) || srcPin.type !== '*')
          return;
        let srcPinIndex = src.index,
            activeWires = [wire];
        while (activeWires.length) {
          wire = activeWires.pop();
          let dst = self.getWireDst(wire),
              dstPin = getType(dst).inputs[wire.dstPin];
          if (isOutput(dst) && dstPin.type === '*') {
            passThroughs.add([srcPinIndex, dst.index]);
          } else if (dst.passThroughs) {
            dst.passThroughs.forEach(function(passThrough) {
              if (passThrough[0] === wire.dstPin) {
                let outgoingWires = functionChartModel.getOutputs(dst)[passThrough[1]];
                outgoingWires.forEach(wire => activeWires.push(wire));
              }
            });
          }
        }
      });

      if (passThroughs.size) {
        // console.log(passThroughs);
        info.passThroughs = Array.from(passThroughs);
      }
      // console.log(info.type, info.contextType);
      return info;
    },

    build: function(items, parent) {
      const self = this,
            model = this.model,
            graphInfo = model.functionChartModel.getSubgraphInfo(items),
            extents = model.renderer.getBounds(graphInfo.elementsAndGroups),
            spacing = this.theme.spacing,
            x = extents.x - spacing,
            y = extents.y - spacing;

      // Create the new group element.
      const group = this.newGroup(x, y);
      Object.assign(group, this.getGroupTypeInfo(items));

      // Add the group before reparenting the items.
      this.addItem(group, parent);
      items.forEach(function(item) {
        // Re-parent group items; wires should remain connected.
        self.addItem(item, group);
      });
      return group;
    },

    createGroupInstance: function(group, element) {
      const model = this.model,
            items = model.copyPasteModel.cloneItems(group.items, new Map()),
            newGroupItems = {
              id: 0,  // Temporary id, so deepEqual will match non-identically.
              kind: 'group items',
              items: items,
            };
      const groupItems = model.canonicalInstanceModel.internalize(newGroupItems);
      element.groupId = model.dataModel.getId(group);
      element.definitionId = model.dataModel.getId(groupItems);
    },

    findSrcType: function(wire) {
      const self = this,
            model = this.model,
            functionChartModel = model.functionChartModel,
            activeWires = [wire];
      // TODO eliminate array and while; there can be only one pass through.
      while (activeWires.length) {
        wire = activeWires.pop();
        let src = this.getWireSrc(wire),
            srcPin = getType(src).outputs[wire.srcPin],
            dst = this.getWireDst(wire),
            dstPin = getType(dst).inputs[wire.dstPin];
        if (srcPin.type !== '*')
          return srcPin.type;
        if (isGroupInstance(src)) {
          const group = this.getGroupDefinition_(src);
          if (group.passThroughs) {
            group.passThroughs.forEach(function(passThrough) {
              if (passThrough[1] === wire.srcPin) {
                srcPin = group.inputs[passThrough[0]];
                let incomingWire = functionChartModel.getInputs(src)[passThrough[0]];
                if (incomingWire)
                  activeWires.push(incomingWire);
              }
            });
          }
        }
      }
      return '*';
    },

    findDstType: function(wire) {
      const self = this,
            model = this.model,
            graphInfo = model.functionChartModel.getGraphInfo(),
            activeWires = [wire];
      while (activeWires.length) {
        wire = activeWires.pop();
        let src = this.getWireSrc(wire),
            dst = this.getWireDst(wire),
            srcPin = getType(src).outputs[wire.srcPin],
            dstPin = getType(dst).inputs[wire.dstPin];
        if (dstPin.type !== '*')
          return dstPin.type;
        if (isGroupInstance(dst)) {
          const group = this.getGroupDefinition_(src);
          if (group.passThroughs) {
            group.passThroughs.forEach(function(passThrough) {
              if (passThrough[0] === wire.dstPin) {
                dstPin = group.outputs[passThrough[1]];
                let outgoingWires = functionChartModel.getOutputs(dst)[passThrough[1]];
                outgoingWires.forEach(wire => activeWires.push(wire));
              }
            });
          }
        }
      }
      return '*';
    },



    makeConsistent: function () {
      const self = this, model = this.model,
            diagram = this.diagram,
            dataModel = model.dataModel,
            hierarchicalModel = model.hierarchicalModel,
            selectionModel = model.selectionModel,
            observableModel = model.observableModel,
            functionChartModel = model.functionChartModel;

// TODO don't mutate while iterating???
      let graphInfo, elementsAndGroups, wires;
      function refreshGraphInfo() {
       graphInfo = model.functionChartModel.getGraphInfo();
       elementsAndGroups = graphInfo.elementsAndGroups;
       wires = graphInfo.wires;
      }
      refreshGraphInfo();

      // Update groups. Reverse visit so nested groups work correctly.
      reverseVisitItems(diagram.items, function(group) {
        if (group.items.length === 0) {
          self.deleteItem(group);
          refreshGraphInfo();
          return;
        }
        const oldType = group.type,
              oldSig = globalTypeParser_.trimType(group.type),
              info = self.getGroupTypeInfo(group.items, group);
        if (oldSig !== info.type) {
          // Maintain the label of the group.
          let label = oldType.substring(oldSig.length);
          info.type += label;
          // Assign info properties.
          for (let attr in info) {
            observableModel.changeValue(group, attr, info[attr]);
          }
          // Replace any 'self' instances with instances of the new type.
          group.items.forEach(function(item) {
            if (isElement(item) && self.isInstanceOfGroup(item, group)) {
              const newInstance = self.newGroupInstance(
                  item.groupId, item.definitionId, info.type, item.x, item.y);
              self.replaceElement(item, newInstance);
              // Recalculate the graph data.
              refreshGraphInfo();
            }
          });
        }
      }, isGroup);

      elementsAndGroups.forEach(function(element) {
        if (isGroup(element)) {
          // Delete empty groups.
          if (element.items.length === 0) {
            self.deleteItem(element);
            // Recalculate the graph data.
            refreshGraphInfo();
          }
        }
      });

      // Eliminate dangling wires.
      wires.forEach(function(wire) {
        const src = self.getWireSrc(wire),
              dst = self.getWireDst(wire);
        if (!src ||
            !dst ||
            !elementsAndGroups.has(src) ||
            !elementsAndGroups.has(dst) ||
            wire.srcPin >= getType(src).outputs.length ||
            wire.dstPin >= getType(dst).inputs.length) {
          self.deleteItem(wire);
          // Recalculate the graph data.
          refreshGraphInfo();
          return;
        }
        // Make sure wires belong to lowest common container (functionChart or group).
        const lca = hierarchicalModel.getLowestCommonAncestor(src, dst);
        if (self.getParent(wire) !== lca) {
          self.deleteItem(wire);
          self.addItem(wire, lca);
          // Reparenting doesn't change the graph structure.
        }
      });

      assert(functionChartModel.checkConsistency());
    },
  }

*/ 
//# sourceMappingURL=functioncharts.js.map