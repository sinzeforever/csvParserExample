var fs = require('fs'),
    treeName = 'brandstore_v1',
    ccode = 'hk',
    property = 'hkdeals',
    csvFileName = './category.csv',
    outputFileName = './import_data',
    treeAry = [[],[],[],[],[],[]] , // since the csv do not specify tree structure, we create tree structure. 2-D array - [layer][treeId] .. level 0 is root
    nodeData = {}, // the node data that will be used as import data
    lastNode,
    timeframe = "" + Math.floor(Date.now() / 1000),
    taxonomyId = "000003258709",
    treeId = "000003808327",
    catIdIndex = 1,
    dateStamp,
    getDateStamp = function() {
        if (!dateStamp) {
            var today = new Date();
            var yy = today.getFullYear();
            var mm = today.getMonth() + 1;
            var dd = today.getDate();
            if (dd < 10) {
                dd = '0' + dd;
            }
            if (mm < 10) {
                mm = '0' + mm;
            }
            yy = yy.toString().substring(2,4);
            dateStamp = yy + mm + dd;
        }
        return dateStamp;
    },
    writeFile = function(fn, str) {
        fs.writeFile(fn, str, function(err) {
            if(err) {
                return console.log(err);
            }
            console.log("Output file was saved to " + fn);
        });
    },
    // parse the raw full csv string
    parseRawStr = function(rawStr) {
        //  restructure file str
        //  remove \n in ""
        var inQuote = false,
            result = '',
            c;

        for (var i = 0; i < rawStr.length; i++) {
            c = rawStr.charAt(i);
            if ( c == '"') {
                c = '';
                inQuote = !inQuote;
            } else if (c == '\n' && inQuote) {
                c = '';
            }
            result += c;
        }

        // split the string to array
        result = result.split('\n');
        return result;
    },
    // append the attribute data of tmp node to previous node
    appendAttribute = function(node, rawNode) {
        if (!node || !rawNode || !rawNode['attributeName']) {
            return;
        }
        if (!node.attributes) {
            node.attributes = {};
        }

        var attributeName = rawNode['attributeName'],
            attributeValue,
            attributeType,
            attribute,
            parseAttributeValueString = function(valueStr) { // attribute value is separate by || ; parse it into json array
                var token = "||",
                    result = valueStr.split(token);

                // remove empty entries to prevent bug
                for (var i = 0; i < result.length; i++) {
                    if (!result[i]) {
                        result.splice(i, 1);
                    }
                }
                return result;
            },
            setAttributeText = function() {
                attributeType = 'text';
                attributeValue = {
                    "max": 20,
                    "min": 1
                };
            },
            setAttributeCheckBox = function() {
                attributeType = 'checkbox';
                attributeValue = parseAttributeValueString(rawNode['attributeValue']);
            },
            setAttributeRadioBox = function() {
                attributeType = 'radiobox';
                attributeValue = parseAttributeValueString(rawNode['attributeValue']);
            },
            checkAttributeType = function() { // function which judge the attribute type and value
                var inputType = rawNode['attributeType'].toLowerCase();
                if (inputType == 'checkbox') {
                    setAttributeCheckBox();
                } else if (inputType == 'radiobox') {
                    setAttributeRadioBox();
                } else if (inputType == 'text') {
                    setAttributeText();
                } else if (rawNode['attributeValue'] && rawNode['attributeValue'].search("||") > 0) {
                    // if value is not empty, we suppose it is checkbox
                    setAttributeCheckBox();
                } else {
                    setAttributeText();
                }
            };

        // check attribute to decide type and value
        checkAttributeType();

        attribute = {
            "required": false,
            "searchable": (rawNode['searchable'].toLowerCase() == 'yes' ? true : false),
            "type": attributeType,
            "value": attributeValue
        };

        node.attributes[attributeName] = attribute;
    },
    // get auto increment category id
    // category id can be defined by ourself
    getNextCategoryId = function() {
        var result,
            idStr = "" + catIdIndex;
        result = idStr;
        catIdIndex += 1;
        return result;
    },
    // check the elder sibling id. Logic: if the last processed node has the same parent and same level, it's the elder sibling; return 0 if eldest
    getElderSiblingId = function(parentId, level) {
        var lastNodeOfLevel = treeAry[level][treeAry[level].length-1];
        if (lastNodeOfLevel && lastNodeOfLevel.parent_cat_id == parentId) {
            return lastNodeOfLevel.cat_id;
        }
        return "0";
    },
    searchNodeInLevel = function(name, level, parentId) {
        if (!treeAry[level]) {
            return;
        }
        for (var i = 0; i < treeAry[level].length; i++) {
            if (treeAry[level][i].name == name) {
                // if parent Id is specify, check the parent id constraint
                if (!parentId || treeAry[level][i].parent_cat_id == parentId) {
                    return treeAry[level][i];
                }
            }
        }
        return null;
    },
    // get the parent node id
    saveNodeInTreeAry = function(node, level) {
        treeAry[level].push(node);
    },
    createNode = function(level, name, spaceId, parentId, catId) {
        var node =  {
                "cat_id": (catId ? catId : getNextCategoryId()),
                "alias_cat_id": null,
                "cluster_id": null,
                "created": timeframe,
                "cust_data": null,
                "modified": timeframe,
                "name": name,
                "parent_cat_id": parentId,
                "prev_sibling_cat_id": getElderSiblingId(parentId, level),
                "space_id": spaceId,
                "taxonomy_node_id": taxonomyId,
                "timeframe": timeframe,
                "tree_id": treeId,
                "type": "1"
            };

        // save the node info in the tree
        saveNodeInTreeAry(node, level);

        // append new node to the node list
        nodeData[node.cat_id] = node;
        return node;
    },
    // create a formal category node, follow the category egs json format
    createNodeByRawNode = function(rawNode) {
        var level,
            name,
            spaceId = rawNode['spaceId'],
            currentNode,
            parentName = "root",
            parentNode,
            node;

        // to get the more category info, we have to parse l1~l6 columns to check its level
        // if next level is not empty, we traverse forward
        // we can get the category name of the node and the parent + sibling id from its level

        level = 1;
        name =  rawNode['l' + level];
        parentNode = searchNodeInLevel(parentName, level - 1);

        while (rawNode['l' + (level + 1)]) {
            // since the csv only record leaf node, we have to generate nodes on the path
            // check if the parent node exist. if not, we create a node for it
            currentNode = searchNodeInLevel(name, level, parentNode.cat_id);
            if (!currentNode) {
                currentNode = createNode(level, name, spaceId, parentNode.cat_id);
            }

            // go to next level
            level += 1;
            parentName = name;
            parentNode = currentNode;
            name = rawNode['l' + level];
        }

        // create node by the info we got
        // if the same leaf already exist (error in csv), do nothing
        if (searchNodeInLevel(name, level, parentNode.cat_id)) {
            return null;
        } else {
            // normal case, create leaf node
            node = createNode(level, name, spaceId, parentNode.cat_id);
            // append the attribute info onto the node
            appendAttribute(node, rawNode);
            node.level = level;
            return node;
        }
    },
    // create a tmp category node by a csv data row
    createRawNodeByRow = function(row) {
        var rowData = row.split(','),
            csvColumns = ['hotlistpath', 'spaceId', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'attributeName', 'attributeValue',
            'require', 'searchable', 'searchType', 'attributeType'], // define csv column -> json object name
            node = {};

        for (var i = 0; i < rowData.length; i++) {
            if (csvColumns[i]) {
                node[csvColumns[i]] = rowData[i];
            }
        }
        return node;
    },
    parseRow = function(row) {
        var rawNode = createRawNodeByRow(row);

        // A row can specify a new category node, or just a new attribute of the previous category node
        // if l1~l6 is empty, we consider that a row is for new attribute and we append the attribute to the previous node
        if (!rawNode.l1) {
            // append the attribute info onto the node
            appendAttribute(lastNode, rawNode);
        } else { // else we append the node to the data
            lastNode = createNodeByRawNode(rawNode)
        }
    },
    makeFinalResult = function() {
        var result = {
            "request_data" : {
                "tree": {
                    "name": treeName,
                    "ccode": ccode,
                    "property": property
                },
                "nodes": nodeData
            }
        };
        writeFile(outputFileName, JSON.stringify(result));
    },
    processCSV = function(rawStr) {
        var rowAry = parseRawStr(rawStr);

        // skip first row
        for (var i = 1; i < rowAry.length; i++) {
            parseRow(rowAry[i]);
        }
        makeFinalResult();
    },
    readFile = function(file) {
        fs.readFile(file, 'utf8', function (err,result) {
          if (err) {
            return console.log(err);
          }
          // process csv after file load
          processCSV(result);
        });
    },
    createRoot = function() {
        createNode(0, "root", "0", "0", "0");
    },
    init = function() {
        createRoot();
        readFile(csvFileName);
    };


init();




